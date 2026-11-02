// Hoja «Opciones del paciente» (DESIGN C3f y C-16): límite de volumen y tres interruptores, guardados por perfil.
// Se abre desde la cabecera del perfil. Guarda con store.updateProfile(id, { options }).
// Las funciones puras se prueban en tests/web-unit/cuidador-perfil.test.mjs.

import { createErrorNode, createSwitch, el, labeledField, messageOf, openDialog } from './perfiles.js';
import { DEFAULT_PATIENT_OPTIONS } from '../store.js';
import { validatePatientOptions } from '../schema.js';

// Límites de volumen del perfil: de 50 % a 100 % en pasos de 10 %, como el reproductor (DESIGN 8.1).
export const VOLUME_LIMIT_OPTIONS = Object.freeze([50, 60, 70, 80, 90, 100]);

// Valores que ofrece el selector: los del paso de 10 % y, si el perfil guarda otro valor válido, también ese.
export function volumeChoices(current) {
  const values = new Set(VOLUME_LIMIT_OPTIONS);
  if (Number.isInteger(current) && current >= 50 && current <= 100) values.add(current);
  return [...values].sort((a, b) => a - b);
}

// Opciones válidas a partir de los campos del formulario. Devuelve { options, error } con el primer problema.
export function normalizePatientOptions(input = {}) {
  const options = {
    volumeLimit: Number(input.volumeLimit),
    repeatList: Boolean(input.repeatList),
    resumeOnOpen: Boolean(input.resumeOnOpen),
    seekOnTap: Boolean(input.seekOnTap),
  };
  const [problem] = validatePatientOptions(options);
  if (problem) return { options: null, error: problem };
  return { options, error: null };
}

// Perfil por identificador, o null si ya no existe.
async function findProfile(store, profileId) {
  return (await store.listProfiles()).find((item) => item.id === profileId) ?? null;
}

// Bloque de un interruptor con su explicación debajo (DESIGN C-13).
function switchBlock(control, help) {
  return el('div', { class: 'cp-opcion-bloque' }, control.element, el('p', { class: 'cp-campo-ayuda' }, help));
}

// Abre la hoja de opciones del paciente del perfil. Resuelve con el perfil guardado, o null si se cancela.
export async function openPatientOptions(services, profileId) {
  const profile = await findProfile(services.store, profileId);
  if (!profile) {
    return openDialog({
      title: 'Opciones del paciente',
      testid: 'c-options-dialog',
      build: () => {
        const missing = createErrorNode({ id: 'cp-opciones-no-perfil' });
        missing.show('No se encuentra este perfil. Vuelve a la lista de perfiles.');
        return [missing.node];
      },
    });
  }
  const current = { ...DEFAULT_PATIENT_OPTIONS, ...(profile.options ?? {}) };

  return openDialog({
    title: 'Opciones del paciente',
    testid: 'c-options-dialog',
    initialFocus: 'select',
    build: (close) => {
      const problem = createErrorNode({ id: 'cp-opciones-error' });
      const volumeSelect = el('select', { class: 'cp-select', 'data-testid': 'c-options-volume' },
        volumeChoices(current.volumeLimit).map((value) => el('option', { value: String(value) }, `${value} %`)));
      volumeSelect.value = String(current.volumeLimit);
      const volume = labeledField({
        id: 'cp-opc-volumen',
        label: 'Límite de volumen',
        control: volumeSelect,
        help: 'El paciente no puede subir el volumen por encima de este porcentaje. Por defecto, 100 %.',
      });
      const repeat = createSwitch({ label: 'Repetir lista', checked: current.repeatList, testid: 'c-options-repeat' });
      const resume = createSwitch({ label: 'Reanudar al abrir', checked: current.resumeOnOpen, testid: 'c-options-resume' });
      const seek = createSwitch({ label: 'Saltar al tocar la barra', checked: current.seekOnTap, testid: 'c-options-seek' });
      const cancel = el('button', { type: 'button', class: 'cp-boton cp-boton--secundario', 'data-testid': 'c-options-cancel' },
        'Cancelar');
      const save = el('button', { type: 'button', class: 'cp-boton cp-boton--primario', 'data-testid': 'c-options-save' },
        'Guardar');
      cancel.addEventListener('click', () => close(null));
      save.addEventListener('click', async () => {
        const { options, error } = normalizePatientOptions({
          volumeLimit: volumeSelect.value,
          repeatList: repeat.getChecked(),
          resumeOnOpen: resume.getChecked(),
          seekOnTap: seek.getChecked(),
        });
        if (error) {
          problem.show(error);
          return;
        }
        save.disabled = true;
        cancel.disabled = true;
        try {
          const saved = await services.store.updateProfile(profile.id, { options });
          services.announce('Opciones guardadas.');
          close(saved);
        } catch (failure) {
          save.disabled = false;
          cancel.disabled = false;
          problem.show(messageOf(failure));
        }
      });
      return [
        el('p', { class: 'cp-texto-ayuda' }, `Opciones de ${profile.alias} en modo paciente. Se guardan en este perfil.`),
        problem.node,
        volume.element,
        switchBlock(repeat, 'Al terminar la lista, vuelve a empezar. Por defecto, sí.'),
        switchBlock(resume, 'Al abrir la app, reproduce la última canción en la posición guardada. Por defecto, no.'),
        switchBlock(seek, 'Un toque en la barra de progreso salta a ese punto. Por defecto, la barra solo informa.'),
        el('div', { class: 'cp-dialogo-pie' }, cancel, save),
      ];
    },
  });
}
