import { Input } from "@/components/ui/input";
import { formatCurrencyInput } from "@/lib/currency-input";

export function CurrencyInput({
  value,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Input
      inputMode="numeric"
      value={value}
      onChange={(event) => {
        onValueChange(formatCurrencyInput(event.target.value));
      }}
      {...props}
    />
  );
}
