import { createFileRoute } from "@tanstack/react-router";
import { EmptyWidget } from "./-components/EmptyWidget";
import { MinimalToolbar } from "./-components/MinimalToolbar";
import { Loader } from "../-components/Loader";
import { DialogDemo } from "./-components/AuthDialog";

export const Route = createFileRoute("/auth/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <MinimalToolbar />
      <div className="flex flex-col items-center justify-center h-full w-full">
        <DialogDemo />
      </div>
    </>
  );
}
