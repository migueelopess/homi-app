import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

const THRESHOLD = 68;   // pull past this to trigger
const MAX_PULL = 104;   // rubber-band stops here
const RESISTANCE = 0.5; // finger travel → pull distance

// Pull down from the top to refresh, like a native app: the page follows the
// finger, and while it refreshes the content blurs behind a centred spinner.
//
// Note on `transform`/`filter`: both make an element a containing block, which
// traps `position: fixed` descendants inside its box. Every overlay in the app
// is portaled to <body> so it escapes this wrapper — and when idle we set them
// back to `none` rather than `translateY(0)`, because an identity transform
// still creates the containing block.
export default function PullToRefresh({ onRefresh, children }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const pullRef = useRef(0);
  const startYRef = useRef(null);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const setPullDistance = (value) => {
      pullRef.current = value;
      setPull(value);
    };

    const reset = () => {
      startYRef.current = null;
      pullingRef.current = false;
      setPullDistance(0);
    };

    const onTouchStart = (e) => {
      if (refreshingRef.current || e.touches.length !== 1) return;
      // Only arm the gesture when already at the very top of the page.
      if (window.scrollY > 0) return;
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = false;
    };

    const onTouchMove = (e) => {
      if (refreshingRef.current || startYRef.current === null) return;

      const delta = e.touches[0].clientY - startYRef.current;

      // Upward move, or the page scrolled away from the top: this is a normal
      // scroll, so let go of the gesture entirely.
      if (delta <= 0 || window.scrollY > 0) {
        if (!pullingRef.current) startYRef.current = null;
        else reset();
        return;
      }

      pullingRef.current = true;
      setPullDistance(Math.min(MAX_PULL, delta * RESISTANCE));
      // Suppress the browser's own overscroll/pull-to-refresh while ours runs.
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = async () => {
      if (startYRef.current === null) return;
      const shouldRefresh = pullingRef.current && pullRef.current >= THRESHOLD;

      startYRef.current = null;
      pullingRef.current = false;

      if (!shouldRefresh) {
        setPullDistance(0);
        return;
      }

      refreshingRef.current = true;
      setRefreshing(true);
      setPullDistance(THRESHOLD); // hold the page open while it loads
      try {
        await onRefresh?.();
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPullDistance(0);
      }
    };

    // touchmove must be non-passive so preventDefault() can stop the native
    // overscroll gesture from fighting this one.
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onRefresh]);

  const progress = Math.min(1, pull / THRESHOLD);
  const armed = progress >= 1;
  const settling = pull === 0 || refreshing;

  return (
    <>
      {/* Arrow that trails the finger, handing over to the centred spinner */}
      <div
        aria-hidden="true"
        className="fixed inset-x-0 z-40 flex justify-center pointer-events-none"
        style={{
          top: 'calc(3.5rem + env(safe-area-inset-top))',
          transform: pull > 0 ? `translateY(${pull - 46}px)` : 'translateY(-46px)',
          opacity: pull > 0 && !refreshing ? 1 : 0,
          transition: settling ? 'transform 0.3s cubic-bezier(0.22,1,0.36,1), opacity 0.2s ease' : 'opacity 0.2s ease',
        }}
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center
                        bg-card/80 backdrop-blur-xl backdrop-saturate-150
                        border border-white/25 dark:border-white/10
                        shadow-[0_4px_16px_rgba(0,0,0,0.18)]">
          <RefreshCw
            className={`w-[18px] h-[18px] transition-colors ${armed ? 'text-primary' : 'text-muted-foreground'}`}
            style={{ transform: `rotate(${progress * 270}deg)` }}
          />
        </div>
      </div>

      {/* The page itself, following the finger */}
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : 'none',
          filter: refreshing ? 'blur(3px)' : 'none',
          opacity: refreshing ? 0.55 : 1,
          pointerEvents: refreshing ? 'none' : undefined,
          transition: settling
            ? 'transform 0.3s cubic-bezier(0.22,1,0.36,1), filter 0.25s ease, opacity 0.25s ease'
            : 'filter 0.25s ease, opacity 0.25s ease',
        }}
      >
        {children}
      </div>

      {/* Sibling of the blurred wrapper, so it stays sharp */}
      {refreshing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2.5 px-5 py-4 rounded-3xl
                          bg-card/85 backdrop-blur-2xl backdrop-saturate-150
                          border border-white/25 dark:border-white/10
                          shadow-[0_10px_40px_rgba(0,0,0,0.25)]">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
            <span className="text-xs font-semibold text-foreground">A atualizar...</span>
          </div>
        </div>
      )}
    </>
  );
}
