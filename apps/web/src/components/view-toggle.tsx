import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function ViewToggle<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  className?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      orientation="horizontal"
      className={cn("w-auto !flex-row gap-0", className)}
    >
      <TabsList variant="default" className="h-9 w-full min-w-0 sm:w-fit">
        {options.map((opt) => (
          <TabsTrigger key={opt.id} value={opt.id} className="px-3 text-sm">
            {opt.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
