import * as Icons from "lucide-react";
export function Icon({ name, size = 16, ...rest }: { name: string; size?: number; [k: string]: any }) {
  const C = (Icons as any)[name] ?? Icons.Hexagon;
  return <C size={size} {...rest} />;
}
