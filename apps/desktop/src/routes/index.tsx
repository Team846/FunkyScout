import { createFileRoute } from "@tanstack/react-router";
import { Loader } from "./-components/Loader";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <Loader />
    </>
  );
}
