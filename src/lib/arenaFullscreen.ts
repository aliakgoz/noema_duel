import { Capacitor, registerPlugin } from '@capacitor/core';

const nativeArena = registerPlugin<{ setEnabled(options: { enabled: boolean }): Promise<void> }>('ArenaFullscreen');

/** Browser fullscreen has a CSS fallback; Android also uses its immersive window. */
export async function setArenaFullscreen(enabled: boolean): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try { await nativeArena.setEnabled({ enabled }); }
  catch (error) { console.warn('Android tam ekran ayarı uygulanamadı; arena görünümü kullanılabilir.', error); }
}
