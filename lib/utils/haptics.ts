/**
 * Haptics utility with browser fallback
 * TODO: Once @capacitor/haptics is installed, uncomment Capacitor code and remove browser fallback
 */

// Browser Vibration API fallback
const browserVibrate = (pattern: number | number[]) => {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
};

/**
 * Light tap feedback for button presses
 */
export const vibrateTap = async () => {
  // TODO: Uncomment when Capacitor is installed
  // await Haptics.impact({ style: ImpactStyle.Light });

  // Browser fallback
  browserVibrate(10);
};

/**
 * Three-burst shake pattern for countdown
 */
export const vibrateShake = async () => {
  // TODO: Uncomment when Capacitor is installed
  // await Haptics.impact({ style: ImpactStyle.Heavy });
  // await new Promise(r => setTimeout(r, 100));
  // await Haptics.impact({ style: ImpactStyle.Heavy });
  // await new Promise(r => setTimeout(r, 100));
  // await Haptics.impact({ style: ImpactStyle.Heavy });

  // Browser fallback - three bursts
  browserVibrate([100, 100, 100, 100, 100]);
};

/**
 * Single buzz for mode switch
 */
export const vibrateBuzz = async () => {
  // TODO: Uncomment when Capacitor is installed
  // await Haptics.impact({ style: ImpactStyle.Medium });

  // Browser fallback
  browserVibrate(50);
};

/**
 * Success notification haptic
 */
export const vibrateSuccess = async () => {
  // TODO: Uncomment when Capacitor is installed
  // await Haptics.notification({ type: NotificationType.Success });

  // Browser fallback
  browserVibrate([50, 50, 50]);
};
