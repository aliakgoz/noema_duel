import { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_MARKER = '__noemaPlayableFullscreen';

/** Keep the same live scene and controls in both browser and WebView fullscreen. */
export function usePlayableFullscreen({ documentRoot = false, onEscape }: { documentRoot?: boolean; onEscape?: () => boolean } = {}) {
  const host = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const browserFullscreen = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const historyToken = useRef('');
  const fullscreenTarget = useCallback(() => documentRoot ? document.documentElement : host.current, [documentRoot]);

  const close = useCallback((removeHistory = true) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    if (document.fullscreenElement === fullscreenTarget()) void document.exitFullscreen().catch(() => {});
    browserFullscreen.current = false;
    if (removeHistory && historyToken.current && window.history.state?.[HISTORY_MARKER] === historyToken.current) window.history.back();
  }, [fullscreenTarget]);

  const open = useCallback(() => {
    const element = host.current;
    if (!element || activeRef.current) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeRef.current = true;
    setActive(true);
    historyToken.current = `${Date.now()}-${Math.random()}`;
    try { window.history.pushState({ ...window.history.state, [HISTORY_MARKER]: historyToken.current }, ''); }
    catch { historyToken.current = ''; }
    // Some Android WebViews expose this method but reject it. The fixed CSS
    // layout is already active, so a rejection leaves a fully playable screen.
    const target = fullscreenTarget();
    if (target && typeof target.requestFullscreen === 'function') {
      try {
        void target.requestFullscreen({ navigationUI: 'hide' }).then(() => {
          if (activeRef.current) browserFullscreen.current = document.fullscreenElement === target;
          else if (document.fullscreenElement === target) void document.exitFullscreen().catch(() => {});
        }).catch(() => {});
      } catch { /* CSS fullscreen also covers synchronous WebView rejection. */ }
    }
  }, [fullscreenTarget]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement === fullscreenTarget() && activeRef.current) browserFullscreen.current = true;
      else if (browserFullscreen.current) close();
    };
    const onPopState = () => {
      if (activeRef.current && window.history.state?.[HISTORY_MARKER] !== historyToken.current) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (event.key === 'Escape' && onEscape?.()) { event.preventDefault(); return; }
      // Let a root-level dialog handle Escape/Tab before the arena exits or traps focus.
      if (documentRoot && [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
        .some(dialog => !host.current?.contains(dialog) && dialog.getClientRects().length > 0)) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab' || !host.current) return;
      const buttons = [...host.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"], summary')]
        .filter(element => element.getClientRects().length > 0);
      if (!buttons.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !host.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !host.current.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [close, documentRoot, fullscreenTarget, onEscape]);

  useEffect(() => {
    if (!active) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    const rootOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.classList.add('playable-fullscreen-open');
    host.current?.querySelector<HTMLButtonElement>('[data-fullscreen-exit]')?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      document.documentElement.style.overscrollBehavior = rootOverscroll;
      document.body.classList.remove('playable-fullscreen-open');
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [active]);

  return { host, active, activeRef, open, close };
}
