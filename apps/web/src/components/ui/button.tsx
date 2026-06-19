import * as React from "react";
import { cn } from "../../lib/utils";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ className, type = "button", ...props }: ButtonProps) {
  return <button className={cn("button", className)} type={type} {...props} />;
}
