// Pruebas de la lógica de Inicio del cuidador (frontend/web/js/cuidador/inicio.js): fechas, última sesión,
// resumen del día, pendientes, detección de iOS y avisos (DESIGN C1 y 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_REMINDER_DAYS,
  buildNotices,
  daysBetween,
  formatStudyTime,
  isIosBrowser,
  isStandaloneApp,
  lastSessionAt,
  localDayKey,
  summarizePending,
  summaryText,
  todaySummary,
} from '../../frontend/web/js/cuidador/inicio.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);

test('los días entre dos marcas son completos y nunca negativos', () => {
  assert.equal(daysBetween(0, 15 * DAY), 15);
  assert.equal(daysBetween(10, 5), 0);
  assert.equal(daysBetween(Number.NaN, 5), 0);
});

test('el día del registro es el local en formato AAAA-MM-DD', () => {
  assert.equal(localDayKey(new Date(2026, 10, 2, 9, 30)), '2026-11-02');
  assert.equal(localDayKey(new Date(2026, 0, 9)), '2026-01-09');
});

test('la fecha de un evento se lee de su propia marca, sin conversión de zona', () => {
  assert.equal(formatStudyTime('2026-11-02T15:30:00+01:00'), '2 nov 2026, 15:30');
  assert.equal(formatStudyTime('2026-01-09T08:05:00Z'), '9 ene 2026, 08:05');
  assert.equal(formatStudyTime('no es una fecha'), '');
  assert.equal(formatStudyTime('2026-13-01T10:00:00Z'), '');
});

test('la última sesión es el último evento de inicio de sesión', () => {
  const events = [
    { type: 'start', at: '2026-11-01T09:00:00+01:00' },
    { type: 'session-start', at: '2026-10-30T10:00:00+01:00' },
    { type: 'session-start', at: '2026-11-01T18:20:00+01:00' },
    { type: 'track-end', at: '2026-11-02T08:00:00+01:00' },
  ];
  assert.equal(lastSessionAt(events), '2026-11-01T18:20:00+01:00');
  assert.equal(lastSessionAt([]), null);
});

test('el resumen del día sale del historial agrupado por día, y null si hoy no hay escuchas', () => {
  const days = [
    { day: '2026-11-01', summary: { listens: 1, minutes: 3, skipped: 0 } },
    { day: '2026-11-02', summary: { listens: 14, minutes: 42, skipped: 3 } },
  ];
  assert.deepEqual(todaySummary(days, '2026-11-02'), { listens: 14, minutes: 42, skipped: 3 });
  assert.equal(todaySummary(days, '2026-11-03'), null);
  assert.equal(todaySummary([], '2026-11-02'), null);
});

test('el texto del resumen sigue el ejemplo del DESIGN C-24 y pluraliza bien', () => {
  assert.equal(summaryText({ listens: 14, minutes: 42, skipped: 3 }), '14 escuchas · 42 minutos · 3 saltadas');
  assert.equal(summaryText({ listens: 1, minutes: 1, skipped: 0 }), '1 escucha · 1 minuto · 0 saltadas');
});

test('los pendientes cuentan canciones sin familiaridad, recuerdos sin foto y listas vacías', () => {
  const pending = summarizePending({
    songs: [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }],
    links: [{ songId: 'S1', familiarity: 3 }, { songId: 'S2', familiarity: 0 }],
    memories: [{ photoIds: [] }, { photoIds: ['p1'] }, {}],
    playlists: [{ songIds: [] }, { songIds: ['S1'] }],
  });
  assert.deepEqual(pending, { songsWithoutFamiliarity: 2, memoriesWithoutPhoto: 2, emptyPlaylists: 1 });
});

test('se reconoce iPhone, iPad y el iPadOS que se identifica como Mac, pero no Android ni Mac sin pantalla táctil', () => {
  assert.equal(isIosBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
  assert.equal(isIosBrowser('Mozilla/5.0 (iPad; CPU OS 17_0)'), true);
  assert.equal(isIosBrowser('Mozilla/5.0 (Macintosh)', { maxTouchPoints: 5, platform: 'MacIntel' }), true);
  assert.equal(isIosBrowser('Mozilla/5.0 (Macintosh)', { maxTouchPoints: 0, platform: 'MacIntel' }), false);
  assert.equal(isIosBrowser('Mozilla/5.0 (Linux; Android 14)'), false);
});

test('la app está instalada si se abre en modo independiente', () => {
  assert.equal(isStandaloneApp({ matchesStandalone: true }), true);
  assert.equal(isStandaloneApp({ navigatorStandalone: true }), true);
  assert.equal(isStandaloneApp({}), false);
});

test('sin perfiles no hay avisos de copia ni de persistencia; con datos sí', () => {
  const none = buildNotices({ now: NOW, hasProfiles: false, persisted: false, studyRecording: false });
  assert.deepEqual(none, []);
  const withData = buildNotices({ now: NOW, hasProfiles: true, lastBackupAt: null, persisted: false, studyRecording: false });
  assert.deepEqual(withData.map((notice) => notice.key), ['backup', 'persist']);
});

test('la copia avisa cuando pasan más de 14 días y no antes', () => {
  assert.equal(BACKUP_REMINDER_DAYS, 14);
  const exactly = buildNotices({ now: NOW, hasProfiles: true, lastBackupAt: NOW - 14 * DAY, studyRecording: false });
  assert.deepEqual(exactly.map((notice) => notice.key), []);
  const late = buildNotices({ now: NOW, hasProfiles: true, lastBackupAt: NOW - 15 * DAY, studyRecording: false });
  assert.equal(late[0].key, 'backup');
  assert.ok(late[0].text.includes('Hace 15 días'));
  assert.equal(late[0].link, 'ajustes');
});

test('el aviso de almacenamiento aparece por encima del 80 % de la cuota y no antes', () => {
  const above = buildNotices({ now: NOW, hasProfiles: false, usage: 85, quota: 100, studyRecording: false });
  assert.equal(above[0].key, 'storage');
  assert.ok(above[0].text.includes('al 85 %'));
  const exact = buildNotices({ now: NOW, hasProfiles: false, usage: 80, quota: 100, studyRecording: false });
  assert.deepEqual(exact, []);
  const noQuota = buildNotices({ now: NOW, hasProfiles: false, usage: 90, quota: null, studyRecording: false });
  assert.deepEqual(noQuota, []);
});

test('el registro del estudio activo y la recomendación de instalar en iOS tienen su aviso', () => {
  const notices = buildNotices({ now: NOW, hasProfiles: false, studyRecording: true, iosNotInstalled: true });
  assert.deepEqual(notices.map((notice) => notice.key), ['study', 'ios']);
  assert.equal(notices[1].link, null);
  assert.ok(notices[1].text.includes('pantalla de inicio'));
});

test('el orden de los avisos es copia, almacenamiento, persistencia, registro e iOS', () => {
  const notices = buildNotices({
    now: NOW,
    hasProfiles: true,
    lastBackupAt: null,
    usage: 95,
    quota: 100,
    persisted: false,
    studyRecording: true,
    iosNotInstalled: true,
  });
  assert.deepEqual(notices.map((notice) => notice.key), ['backup', 'storage', 'persist', 'study', 'ios']);
});
