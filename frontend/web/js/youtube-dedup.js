// Detecta las pistas de una playlist YouTube que ya están en la biblioteca y las aparta antes de convertir
// (ADR-0019 ampliado). Reusa la regla tolerante `isSameLibraryTrack` (ADR-0046, library-match.js): ignora
// diferencias cosméticas (feat., remaster…) sin confundir una versión en directo o un remix con la de estudio.
// Espejo exacto de mobile/lib/youtube_dedup.dart.
//
// El proxy /api/youtube/playlist del Worker no devuelve duración por pista; `isSameLibraryTrack` decide por
// título + artista en ese caso, que es exactamente para lo que se diseñó.

import { isSameLibraryTrack } from './library-match.js';

/**
 * Parte la lista de items devuelta por listarPlaylist en «ya la tienes» vs «es nueva».
 * @param {Array<{title:string,artist?:string,url:string,durationS?:number}>} items — items del proxy.
 * @param {Array<{title:string,artist?:string,durationS?:number}>} librarySongs — catálogo publicado.
 * @returns {{all:Array,toDownload:Array,skipped:Array,total:number,alreadyCount:number,newCount:number}}
 */
export function filterYoutubePlaylist(items, librarySongs) {
  const all = Array.isArray(items) ? items.slice() : [];
  const library = (Array.isArray(librarySongs) ? librarySongs : []).map((song) => ({
    title: song?.title ?? '',
    artist: song?.artist ?? '',
    durationS: typeof song?.durationS === 'number' ? song.durationS : undefined,
  }));
  const toDownload = [];
  const skipped = [];
  for (const item of all) {
    const probe = {
      title: item?.title ?? '',
      artist: item?.artist ?? '',
      // Las playlists de YouTube no llevan duración desde el proxy; durationS queda undefined y library-match
      // (ADR-0046) decide por título+artista cuando falta una de las dos duraciones.
      durationS: typeof item?.durationS === 'number' ? item.durationS : undefined,
    };
    const already = library.some((song) => isSameLibraryTrack(probe, song));
    if (already) skipped.push(item);
    else toDownload.push(item);
  }
  return {
    all,
    toDownload,
    skipped,
    total: all.length,
    alreadyCount: skipped.length,
    newCount: toDownload.length,
  };
}
