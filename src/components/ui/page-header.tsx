import type { ReactNode } from "react";

/**
 * Every page opens the same way: an optional small-caps line that says where
 * you are, the title, and a sentence or two on what the page is for.
 */
export function PageHeader({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  /** Right-aligned extras on wide screens (e.g. a save button). */
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-8 pt-10 sm:pt-14">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="eyebrow mb-3">{eyebrow}</p> : null}
        <h1 className="heading-display text-[34px] sm:text-[44px]">{title}</h1>
        {children ? <div className="lede mt-3">{children}</div> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  );
}

/** The common page column. */
export const PAGE = "mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6";
