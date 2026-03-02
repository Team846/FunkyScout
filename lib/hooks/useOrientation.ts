import { useEffect, useState, useCallback } from 'react';

/**
 * Hook to manage screen orientation for PWA apps.
 * Attempts to lock orientation and detects when device is in wrong orientation.
 *
 * On Android Chrome (including PWA), screen.orientation.lock() only works when
 * the document is in fullscreen. So we expose requestFullscreenAndLock() to be
 * called from a user gesture (e.g. "Tap to allow rotation" button); that
 * requests fullscreen then locks to the preferred orientation.
 *
 * @param preferredOrientation - 'landscape' or 'portrait'
 * @returns isWrongOrientation, requestFullscreenAndLock
 */
export function useOrientation(preferredOrientation: 'landscape' | 'portrait') {
  const [isWrongOrientation, setIsWrongOrientation] = useState(false);

  const checkOrientation = useCallback(() => {
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    const isPortrait = window.matchMedia('(orientation: portrait)').matches;

    if (preferredOrientation === 'landscape' && isPortrait) {
      setIsWrongOrientation(true);
    } else if (preferredOrientation === 'portrait' && isLandscape) {
      setIsWrongOrientation(true);
    } else {
      setIsWrongOrientation(false);
    }
  }, [preferredOrientation]);

  const requestFullscreenAndLock = useCallback(async () => {
    const doc = document.documentElement;
    const requestFs =
      doc.requestFullscreen ||
      (doc as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;

    try {
      if (requestFs) {
        await requestFs.call(doc);
      }
      if ('orientation' in screen && 'lock' in screen.orientation) {
        await (screen.orientation.lock as (orientation: OrientationLockType) => Promise<void>)(
          preferredOrientation
        );
        console.log(`[Orientation] Locked to ${preferredOrientation} (after fullscreen)`);
        checkOrientation();
      }
    } catch (error) {
      console.warn('[Orientation] Fullscreen and/or lock failed:', error);
    }
  }, [preferredOrientation, checkOrientation]);

  useEffect(() => {
    const lockOrientation = async () => {
      try {
        if ('orientation' in screen && 'lock' in screen.orientation) {
          await (screen.orientation.lock as (orientation: OrientationLockType) => Promise<void>)(
            preferredOrientation
          );
          console.log(`[Orientation] Locked to ${preferredOrientation}`);
        }
      } catch {
        // Orientation lock failed without fullscreen (expected on Android PWA).
        // UI can offer requestFullscreenAndLock() on user tap.
        console.log('[Orientation] Lock not available without fullscreen, using detection fallback');
      }
    };

    lockOrientation();
    checkOrientation();

    const landscapeQuery = window.matchMedia('(orientation: landscape)');
    const portraitQuery = window.matchMedia('(orientation: portrait)');

    landscapeQuery.addEventListener('change', checkOrientation);
    portraitQuery.addEventListener('change', checkOrientation);

    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !(document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement) {
        if ('orientation' in screen && 'unlock' in screen.orientation) {
          screen.orientation.unlock();
        }
      }
      checkOrientation();
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    return () => {
      if ('orientation' in screen && 'unlock' in screen.orientation) {
        screen.orientation.unlock();
      }
      if (document.fullscreenElement ?? (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement) {
        const exitFs = document.exitFullscreen ?? (document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen;
        exitFs?.call(document);
      }
      landscapeQuery.removeEventListener('change', checkOrientation);
      portraitQuery.removeEventListener('change', checkOrientation);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, [preferredOrientation, checkOrientation]);

  return { isWrongOrientation, requestFullscreenAndLock };
}
