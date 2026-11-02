"""Pruebas de metrics.py con señales sintéticas de valor conocido.

Uso: python scripts/compression/test_metrics.py   (no necesita pytest)
"""

from __future__ import annotations

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import metrics  # noqa: E402


class PcmDecodingTests(unittest.TestCase):
    def test_interleaved_float32_becomes_frames_by_channels(self) -> None:
        raw = np.array([0.5, -0.25, 1.0, 0.0], dtype="<f4").tobytes()
        samples = metrics.pcm_from_bytes(raw, channels=2)
        self.assertEqual(samples.shape, (2, 2))
        self.assertEqual(samples[0].tolist(), [0.5, -0.25])
        self.assertEqual(samples[1].tolist(), [1.0, 0.0])

    def test_length_not_multiple_of_channels_is_rejected(self) -> None:
        raw = np.array([0.1, 0.2, 0.3], dtype="<f4").tobytes()
        with self.assertRaises(ValueError):
            metrics.pcm_from_bytes(raw, channels=2)


class LagAndAlignmentTests(unittest.TestCase):
    def setUp(self) -> None:
        rng = np.random.default_rng(1234)
        self.ref = rng.standard_normal(20000)

    def test_identical_signals_have_zero_lag_and_unit_correlation(self) -> None:
        self.assertEqual(metrics.estimate_lag(self.ref, self.ref, max_lag=500), 0)
        self.assertAlmostEqual(metrics.alignment_correlation(self.ref, self.ref), 1.0, places=12)

    def test_delayed_output_gives_positive_lag_and_aligns_exactly(self) -> None:
        dec = np.concatenate([np.zeros(7), self.ref[:-7]])  # dec[n] = ref[n - 7]
        lag = metrics.estimate_lag(self.ref, dec, max_lag=500)
        self.assertEqual(lag, 7)
        ref_a, dec_a = metrics.align(self.ref, dec, lag)
        np.testing.assert_allclose(ref_a, dec_a, atol=1e-12)

    def test_advanced_output_gives_negative_lag_and_aligns_exactly(self) -> None:
        dec = np.concatenate([self.ref[5:], np.zeros(5)])  # dec[n] = ref[n + 5]
        lag = metrics.estimate_lag(self.ref, dec, max_lag=500)
        self.assertEqual(lag, -5)
        ref_a, dec_a = metrics.align(self.ref, dec, lag)
        np.testing.assert_allclose(ref_a, dec_a, atol=1e-12)


class SnrTests(unittest.TestCase):
    def test_gain_error_of_ten_percent_gives_twenty_db(self) -> None:
        rng = np.random.default_rng(7)
        ref = rng.standard_normal((4000, 2))
        snr = metrics.snr_db(ref, 1.1 * ref)  # ruido = 0.1 * ref
        self.assertAlmostEqual(snr, 20.0, places=9)

    def test_identical_signals_have_infinite_snr(self) -> None:
        ref = np.linspace(-1.0, 1.0, 1000)[:, None]
        self.assertTrue(math.isinf(metrics.snr_db(ref, ref.copy())))

    def test_shape_mismatch_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            metrics.snr_db(np.zeros((10, 1)), np.zeros((9, 1)))


class LsdTests(unittest.TestCase):
    def test_identical_signals_have_zero_lsd(self) -> None:
        rng = np.random.default_rng(3)
        ref = rng.standard_normal((8192, 2)) * 0.3
        self.assertEqual(metrics.lsd_db(ref, ref.copy()), 0.0)

    def test_half_amplitude_gives_six_db_in_every_bin(self) -> None:
        # Escalar por 0.5 divide la potencia por 4 en todas las bins: 10 log10(4) = 6.0206 dB.
        rng = np.random.default_rng(11)
        ref = rng.standard_normal((16384, 1)) * 0.3
        self.assertAlmostEqual(metrics.lsd_db(ref, 0.5 * ref), 10.0 * math.log10(4.0), places=3)

    def test_signal_shorter_than_one_frame_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            metrics.lsd_db(np.zeros(100), np.zeros(100))


class DurationTests(unittest.TestCase):
    def test_one_extra_sample_at_48k_is_point_zero_two_ms(self) -> None:
        self.assertAlmostEqual(metrics.duration_delta_ms(2880000, 2880001, 48000), 1.0 / 48.0, places=9)


class GainAndLowFrequencyTests(unittest.TestCase):
    def test_best_gain_recovers_a_known_scale(self) -> None:
        rng = np.random.default_rng(5)
        ref = rng.standard_normal((5000, 2))
        self.assertAlmostEqual(metrics.best_gain(ref, 0.5 * ref), 2.0, places=12)
        self.assertAlmostEqual(metrics.best_gain(ref, ref.copy()), 1.0, places=12)

    def test_gain_corrected_snr_removes_a_pure_level_error(self) -> None:
        rng = np.random.default_rng(9)
        ref = rng.standard_normal((4000, 1))
        dec = 0.95 * ref
        gain = metrics.best_gain(ref, dec)
        # Tras corregir la ganancia solo queda el error de redondeo de coma flotante (SNR enorme).
        self.assertGreater(metrics.snr_db(ref, gain * dec), 200.0)
        self.assertLess(metrics.snr_db(ref, dec), 40.0)

    def test_low_frequency_share_of_a_two_tone_signal_is_one_half(self) -> None:
        sample_rate = 44100
        t = np.arange(sample_rate * 10) / sample_rate
        signal = np.sin(2 * np.pi * 5.0 * t) + np.sin(2 * np.pi * 1000.0 * t)
        self.assertAlmostEqual(metrics.low_frequency_energy_share(signal, sample_rate), 0.5, delta=0.01)

    def test_silence_has_undefined_low_frequency_share(self) -> None:
        self.assertTrue(math.isnan(metrics.low_frequency_energy_share(np.zeros(44100), 44100)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
