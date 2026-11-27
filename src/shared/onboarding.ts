import { useCallback, useEffect, useState } from "react";

const DISMISSED_KEY = "tabvault:guideDismissed";
const GUIDE_SEEN_KEY = "tabvault:onboardingGuideSeen";
const ACTIVE_KEY = "tabvault:onboardingActive";

export interface OnboardingProgress {
  savedSession: boolean;
  createdCollection: boolean;
  tabSleepEnabled: boolean;
  exploredGuide: boolean;
  completedCount: number;
  totalCount: number;
  allDone: boolean;
  dismissed: boolean;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, val: boolean): void {
  try {
    if (val) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Shared onboarding state synchronized across Side Panel and Dashboard via localStorage.
 * Existing users who already have both a saved session and a collection are treated as
 * activated so they are never ambushed by first-run prompts.
 */
export function useOnboarding(counts: {
  namedCount: number;
  collectionCount: number;
  suspenderEnabled?: boolean;
}) {
  const [dismissed, setDismissed] = useState<boolean>(() => readFlag(DISMISSED_KEY));
  const [exploredGuide, setExploredGuide] = useState<boolean>(() => readFlag(GUIDE_SEEN_KEY));
  const [onboardingActive, setOnboardingActive] = useState<boolean>(() => readFlag(ACTIVE_KEY));

  // Sync if another extension surface (Side Panel <-> Dashboard) updates localStorage
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DISMISSED_KEY) setDismissed(e.newValue === "1");
      if (e.key === GUIDE_SEEN_KEY) setExploredGuide(e.newValue === "1");
      if (e.key === ACTIVE_KEY) setOnboardingActive(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const savedSession = counts.namedCount > 0;
  const createdCollection = counts.collectionCount > 0;
  const tabSleepEnabled = Boolean(counts.suspenderEnabled);
  const completedCount = [savedSession, createdCollection, tabSleepEnabled, exploredGuide].filter(Boolean).length;
  const totalCount = 4;
  const allDone = completedCount === totalCount;

  // Latch active onboarding once seen with incomplete core steps so completing step 2 never closes the card mid-flow
  useEffect(() => {
    if (!dismissed && (!savedSession || !createdCollection) && !onboardingActive) {
      setOnboardingActive(true);
      writeFlag(ACTIVE_KEY, true);
    }
  }, [dismissed, savedSession, createdCollection, onboardingActive]);

  // Don't show first-run onboarding to established users who already use both core features
  const isAlreadyActivated = savedSession && createdCollection && !readFlag(GUIDE_SEEN_KEY) && !onboardingActive;
  const shouldShow = !dismissed && !isAlreadyActivated;

  const dismiss = useCallback(() => {
    setDismissed(true);
    writeFlag(DISMISSED_KEY, true);
  }, []);

  const markGuideExplored = useCallback(() => {
    setExploredGuide(true);
    writeFlag(GUIDE_SEEN_KEY, true);
  }, []);

  const resetOnboarding = useCallback(() => {
    setDismissed(false);
    setExploredGuide(false);
    writeFlag(DISMISSED_KEY, false);
    writeFlag(GUIDE_SEEN_KEY, false);
  }, []);

  const progress: OnboardingProgress = {
    savedSession,
    createdCollection,
    tabSleepEnabled,
    exploredGuide,
    completedCount,
    totalCount,
    allDone,
    dismissed,
  };

  return {
    progress,
    shouldShow,
    dismiss,
    markGuideExplored,
    resetOnboarding,
  };
}
