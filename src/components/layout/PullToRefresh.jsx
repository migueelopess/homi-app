import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const THRESHOLD = 68;   // pull past this to trigger
const MAX_PULL = 104;   // rubber-band stops here
const RESISTANCE = 0.5; // finger travel → pull distance

// Pull down from the top of the page to refresh, like a native app.
//
// Only the indicator moves — the page content stays put, so nothing reflows
// and the gesture can be abandoned at any point with no visual cost.
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
      setPullDistance(THRESHOLD); // park the spinner at the trigger point
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
  const visible = pull > 0 || refreshing;

  return (
    <>
      <div
        aria-hidden={!visible}
        className="fixed inset-x-0 z-40 flex justify-center pointer-events-none"
        style={{
          top: `calc(3.5rem + env(safe-area-inset-top))`,
          transform: `translateY(${pull > 0 ? pull - 44 : -44}px)`,
          opacity: visible ? 1 : 0,
          transition: refreshing || pull === 0 ? 'transform 0.25s ease, opacity 0.25s ease' : 'none',
        }}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center
                     bg-card/80 backdrop-blur-xl backdrop-saturate-150
                     border border-white/25 dark:border-white/10
                     shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
        >
          <RefreshCw
            className={`w-[18px] h-[18px] transition-colors ${armed || refreshing ? 'text-primary' : 'text-muted-foreground'} ${refreshing ? 'animate-spin' : ''}`}
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
        </div>
      </div>
      {children}
    </>
  );
}
