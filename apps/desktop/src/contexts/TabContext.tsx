import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

export interface Tab {
  id: string;
  path: string;
  title: string;
}

interface TabContextType {
  tabs: Tab[];
  activeTabId: string;
  addTab: (path: string, title: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

const DEFAULT_TAB: Tab = {
  id: "dashboard",
  path: "/dashboard",
  title: "Event Dashboard",
};

interface TabProviderProps {
  children: ReactNode;
  router: any;
}

export function TabProvider({ children, router }: TabProviderProps) {
  const [tabs, setTabs] = useState<Tab[]>([DEFAULT_TAB]);
  const [activeTabId, setActiveTabIdState] = useState<string>("dashboard");
  // Store navigate fn via ref to avoid stale closures
  const navigateRef = useRef<((path: string) => void) | null>(null);

  // Register router navigate
  useEffect(() => {
    navigateRef.current = (path: string) => {
      router.navigate({ to: path });
    };
  }, [router]);

  const addTab = useCallback((path: string, title: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.path === path);
      if (existing) {
        setActiveTabIdState(existing.id);
        return prev;
      }
      const id = path.replace(/\//g, "-").replace(/^-/, "") || "dashboard";
      const newTab: Tab = { id, path, title };
      setActiveTabIdState(id);
      return [...prev, newTab];
    });
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length === 1) return prev; // Never close last tab
        const idx = prev.findIndex((t) => t.id === id);
        const filtered = prev.filter((t) => t.id !== id);

        setActiveTabIdState((currentActive) => {
          if (currentActive !== id) return currentActive;
          // Navigate to adjacent tab
          const nextTab = filtered[Math.max(0, idx - 1)];
          if (nextTab && navigateRef.current) {
            navigateRef.current(nextTab.path);
          }
          return nextTab?.id ?? filtered[0]?.id ?? "dashboard";
        });

        return filtered;
      });
    },
    []
  );

  const setActiveTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab && navigateRef.current) {
        navigateRef.current(tab.path);
      }
      setActiveTabIdState(id);
    },
    [tabs]
  );

  // Listen to router navigation and auto-add tabs
  useEffect(() => {
    const pathToTitle: Record<string, string> = {
      "/dashboard": "Event Dashboard",
      "/shifts": "Shifts",
      "/exclusion-test": "Picklists",
      "/match-edit-test": "Match Edit",
      "/scouter-ratings": "Scouter Ratings",
    };

    const unsubscribe = router.subscribe("onBeforeLoad", (event: any) => {
      const pathname = event.toLocation?.pathname as string | undefined;
      if (!pathname) return;
      const title = pathToTitle[pathname];
      if (title) {
        addTab(pathname, title);
      }
    });

    return unsubscribe;
  }, [router, addTab]);

  return (
    <TabContext.Provider value={{ tabs, activeTabId, addTab, closeTab, setActiveTab }}>
      {children}
    </TabContext.Provider>
  );
}

export function useTabContext() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error("useTabContext must be used within TabProvider");
  }
  return context;
}
