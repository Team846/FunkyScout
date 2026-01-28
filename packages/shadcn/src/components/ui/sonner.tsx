import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      duration={2000}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        style: {
          // Default styles for all toasts
          borderRadius: "var(--radius)",
        },
        classNames: {
          toast: "group-[.toaster]:shadow-lg",
          success: "!bg-[var(--primary)] !text-[var(--primary-foreground)] !border-[var(--primary)]",
          error: "!bg-[var(--destructive)] !text-white !border-[var(--destructive)]",
          warning: "!bg-[var(--destructive)] !text-white !border-[var(--destructive)]",
          info: "!bg-[var(--background)] !text-[var(--foreground)] !border-[var(--border)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
