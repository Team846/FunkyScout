import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Toaster } from "@shadcn/ui/components/sonner.tsx";
import { useEffect } from "react";

const RootLayout = () => {
  const location = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  return (
  <>
      <Outlet />
      <Toaster position="top-center" />
    </>
  );
};

export const Route = createRootRoute({ component: RootLayout });
