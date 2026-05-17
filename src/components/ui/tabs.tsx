import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <div className={cn("flex flex-col", className)} data-active-tab={value}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, { activeTab: value, onTabChange: onValueChange });
        }
        return child;
      })}
    </div>
  );
}

function TabsList({ className, children, activeTab, onTabChange }: any) {
  return (
    <div className={cn("inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground", className)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, { activeTab, onTabChange });
        }
        return child;
      })}
    </div>
  );
}

function TabsTrigger({ value, children, className, activeTab, onTabChange }: any) {
  const isActive = activeTab === value;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all",
        isActive && "bg-background text-foreground shadow-sm",
        className
      )}
      onClick={() => onTabChange?.(value)}
    >
      {children}
    </button>
  );
}

function TabsContent({ value, children, className, activeTab }: any) {
  if (activeTab !== value) return null;
  return <div className={cn("mt-2", className)}>{children}</div>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
