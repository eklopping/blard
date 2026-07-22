import type { ReactNode } from "react";
import { RollingLandscape } from "./RollingLandscape";

export function LobbyShell({
  children,
  loadingLabel,
}: {
  children?: ReactNode;
  /** When set, shows a centered loading caption over the landscape */
  loadingLabel?: string;
}) {
  return (
    <div className="lobby-screen">
      <RollingLandscape />
      <div className="lobby-foreground">
        {loadingLabel ? (
          <div className="lobby-loading">
            <div className="lobby-loading-pulse" />
            <p>{loadingLabel}</p>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
