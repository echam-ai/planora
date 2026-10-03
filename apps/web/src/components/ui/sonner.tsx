import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-2xl group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-pop",
          description: "group-[.toast]:text-muted-foreground",
          // Sonner's own "rich colors" ship fixed light/dark palettes. Token borders keep every
          // toast on the active theme; the type icon and message carry the meaning.
          success: "group-[.toaster]:border-success",
          error: "group-[.toaster]:border-destructive",
          warning: "group-[.toaster]:border-warning",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
