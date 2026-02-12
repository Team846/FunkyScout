import { useEffect, useState } from 'react';

/**
 * Hook to manage screen orientation for PWA apps
 * Attempts to lock orientation and detects when device is in wrong orientation
 *
 * @param preferredOrientation - 'landscape' or 'portrait'
 * @returns isWrongOrientation - true if device is rotated the wrong way
 */
export function useOrientation(preferredOrientation: 'landscape' | 'portrait') {
  const [isWrongOrientation, setIsWrongOrientation] = useState(false);

  useEffect(() => {
    // Try to lock orientation using Screen Orientation API (works on installed PWAs)
    const lockOrientation = async () => {
      try {
        if ('orientation' in screen && 'lock' in screen.orientation) {
          await screen.orientation.lock(preferredOrientation);
          console.log(`[Orientation] Locked to ${preferredOrientation}`);
        }
      } catch (error) {
        // Orientation lock failed (common in PWAs when not installed)
        // We'll rely on CSS fallback and user notification
        console.log('[Orientation] Lock not supported, using detection fallback');
      }
    };

    // Check current orientation and set warning if wrong
    const checkOrientation = () => {
      const isLandscape = window.matchMedia('(orientation: landscape)').matches;
      const isPortrait = window.matchMedia('(orientation: portrait)').matches;

      if (preferredOrientation === 'landscape' && isPortrait) {
        setIsWrongOrientation(true);
      } else if (preferredOrientation === 'portrait' && isLandscape) {
        setIsWrongOrientation(true);
      } else {
        setIsWrongOrientation(false);
      }
    };

    lockOrientation();
    checkOrientation();

    // Listen for orientation changes
    const landscapeQuery = window.matchMedia('(orientation: landscape)');
    const portraitQuery = window.matchMedia('(orientation: portrait)');

    landscapeQuery.addEventListener('change', checkOrientation);
    portraitQuery.addEventListener('change', checkOrientation);

    return () => {
      // Unlock orientation when component unmounts
      if ('orientation' in screen && 'unlock' in screen.orientation) {
        screen.orientation.unlock();
      }
      landscapeQuery.removeEventListener('change', checkOrientation);
      portraitQuery.removeEventListener('change', checkOrientation);
    };
  }, [preferredOrientation]);

  return { isWrongOrientation };
}
