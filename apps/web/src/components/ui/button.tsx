import * as React from "react";
import WaButton from "@awesome.me/webawesome/dist/react/button/index.js";
import { cn } from "../../lib/utils";

export type ButtonProps = Omit<React.ComponentProps<typeof WaButton>, "appearance" | "variant" | "size"> & {
  className?: string;
  type?: "button" | "submit" | "reset";
};

export function Button({ className, type = "button", ...props }: ButtonProps) {
  const classNames = typeof className === "string" ? className.split(/\s+/) : [];
  const isDanger = classNames.some((name) => name.includes("danger"));
  const isGhost = classNames.includes("button-ghost");
  const isSecondary = classNames.includes("button-secondary");
  const isCompact = classNames.includes("icon-button") || classNames.includes("compact-text-button") || classNames.includes("sidebar-collapse-button");

  if (import.meta.env.MODE === "test") {
    return <button className={cn("button", className)} type={type} {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)} />;
  }

  return (
    <WaButton
      aria-disabled={props.disabled ? "true" : undefined}
      appearance={isGhost ? "plain" : isSecondary ? "outlined" : "filled"}
      className={cn("wa-button-adapter", className)}
      role="button"
      size={isCompact ? "s" : "m"}
      tabIndex={props.disabled ? -1 : 0}
      type={type}
      variant={isDanger ? "danger" : isSecondary || isGhost ? "neutral" : "brand"}
      {...props}
    />
  );
}
