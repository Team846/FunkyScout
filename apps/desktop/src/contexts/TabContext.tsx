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
  search?: Record<string, string>;
}

interface TabContextType {
  tabs: Tab[];
  activeTabId: string;
  addTab: (path: string, title: string, search?: Record<string, string>, customId?: string) => void;
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
  const navigateRef = useRef<((path: string, search?: Record<string, string>) => void) | null>(null);

  // Register router navigate
  useEffect(() => {
    navigateRef.current = (path: string, search?: Record<string, string>) => {
      router.navigate({ to: path, search });
    };
  }, [router]);

  const addTab = useCallback((path: string, title: string, search?: Record<string, string>, customId?: string) => {
    const id = customId || path.replace(/\//g, "-").replace(/^-/, "") || "dashboard";
    setTabs((prev) => {
      // Deduplicate by id (not path) so different picklists can coexist
      if (prev.find((t) => t.id === id)) return prev;
      return [...prev, { id, path, title, search }];
    });
    // Always activate the tab (existing or new) — called outside the updater to avoid setState-in-render
    setActiveTabIdState(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      if (tabs.length === 1) return; // Never close last tab
      const idx = tabs.findIndex((t) => t.id === id);
      const filtered = tabs.filter((t) => t.id !== id);
      setTabs(filtered);
      // Navigate outside any setState updater — calling router.navigate() inside a
      // functional updater runs during React's render phase and triggers setState-in-render
      if (activeTabId === id) {
        const nextTab = filtered[Math.max(0, idx - 1)];
        const nextId = nextTab?.id ?? filtered[0]?.id ?? "dashboard";
        setActiveTabIdState(nextId);
        if (nextTab && navigateRef.current) {
          navigateRef.current(nextTab.path, nextTab.search);
        }
      }
    },
    [tabs, activeTabId]
  );

  const setActiveTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab && navigateRef.current) {
        navigateRef.current(tab.path, tab.search);
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
      "/picklists": "Picklists",
      "/comparison": "Comparison",
      "/match-edit-test": "Match Edit",
      "/scouter-ratings": "Scouter Ratings",
      "/scheduler": "Scheduler",
      // "/picklist-open" intentionally omitted — per-picklist tabs are added explicitly
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
