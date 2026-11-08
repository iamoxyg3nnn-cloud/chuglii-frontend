import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Search,
  X,
  User,
  Tag,
  Clapperboard,
  TrendingUp,
  Trash2,
  Clock,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import { useSearchSuggestions, useListTags, useListPerformers, type SearchSuggestion } from "@/lib/api";
import { readRecentSearches, rememberRecentSearch, clearRecentSearches } from "@/lib/recent-searches";
import { proxyImageUrl } from "@/lib/proxy-url";
import { trackActivity } from "@/lib/rum";

interface SearchDropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TrendingItem = { label: string; href: string; icon: ReactNode };

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function matchScore(label: string, query: string): number {
  const value = normalize(label);
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  if (value.includes(query)) return 2;
  const words = value.split(/\s+/);
  if (words.some((word) => word.startsWith(query))) return 3;
  return Number.MAX_SAFE_INTEGER;
}

function highlightMatch(text: string, query: string): ReactNode {
  const index = normalize(text).indexOf(normalize(query));
  if (!query.trim() || index < 0) return text;
  // Keep the original string's casing and punctuation in the rendered label.
  const exactIndex = text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
  if (exactIndex < 0) return text;
  return (
    <>
      {text.slice(0, exactIndex)}
      <strong className="font-semibold text-foreground">{text.slice(exactIndex, exactIndex + query.trim().length)}</strong>
      {text.slice(exactIndex + query.trim().length)}
    </>
  );
}

export function SearchDropdown({ open, onOpenChange }: SearchDropdownProps) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // A short debounce balances responsive typing with fewer requests on fast typists.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(normalize(search)), 140);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = normalize(search);
  const hasQuery = query.length >= 2;
  const { data: predictionsData, isLoading: predictionsLoading, isFetching: predictionsFetching } =
    useSearchSuggestions(debouncedSearch, { enabled: open && debouncedSearch.length >= 2 });

  const { data: trendingTags } = useListTags({
    enabled: open,
    staleTime: 15 * 60_000,
  });
  const showTrendingPerformers = open && query.length === 0;
  const { data: trendingPerformers } = useListPerformers(
    showTrendingPerformers ? { limit: 5, sort: "count" } : undefined,
    { staleTime: 3 * 60_000, enabled: showTrendingPerformers },
  );

  const predictions = useMemo(() => {
    if (!open || !hasQuery) return [];
    const serverItems = query === debouncedSearch ? predictionsData?.suggestions ?? [] : [];
    const seen = new Set(serverItems.map((item) => `${item.type}:${normalize(item.label)}`));

    // Cached tags fill the small gap while the server suggestion request is in flight.
    const localTags: SearchSuggestion[] = (trendingTags ?? [])
      .map((tag) => ({ tag, score: matchScore(tag.tag, query) }))
      .filter((item) => item.score < Number.MAX_SAFE_INTEGER && !seen.has(`tag:${normalize(item.tag.tag)}`))
      .sort((a, b) => a.score - b.score || b.tag.count - a.tag.count)
      .slice(0, 3)
      .map(({ tag }) => ({
        type: "tag",
        label: tag.tag,
        subtitle: "Topic tag",
        href: `/browse?tags=${encodeURIComponent(tag.tag)}`,
      }));

    const combined = [...serverItems, ...localTags];
    // Render order and keyboard order must be identical; otherwise Enter can
    // activate a different item from the one highlighted by the arrow keys.
    const typeOrder: SearchSuggestion["type"][] = ["performer", "recording", "tag"];
    return typeOrder.flatMap((type) =>
      combined
        .filter((item) => item.type === type)
        .sort((a, b) => matchScore(a.label, query) - matchScore(b.label, query)),
    ).slice(0, 10);
  }, [open, hasQuery, predictionsData, trendingTags, query, debouncedSearch]);

  const filteredRecent = useMemo(() => {
    const list = recentSearches;
    return query ? list.filter((term) => normalize(term).includes(query)).slice(0, 5) : list.slice(0, 5);
  }, [recentSearches, query]);

  const trendingItems = useMemo<TrendingItem[]>(() => {
    const items: TrendingItem[] = [];
    for (const tag of (trendingTags ?? []).slice(0, 4)) {
      items.push({
        label: `#${tag.tag}`,
        href: `/browse?tags=${encodeURIComponent(tag.tag)}`,
        icon: <Tag className="h-3 w-3" />,
      });
    }
    for (const performer of (trendingPerformers?.performers ?? []).slice(0, 3)) {
      items.push({
        label: performer.username,
        href: `/performers/${encodeURIComponent(performer.username)}`,
        icon: <User className="h-3 w-3" />,
      });
    }
    return items.slice(0, 7);
  }, [trendingTags, trendingPerformers]);

  const closeSearch = useCallback(() => {
    onOpenChange(false);
    setSearch("");
    setDebouncedSearch("");
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, [onOpenChange]);

  const navigateTo = useCallback((href: string) => {
    setLocation(href);
    closeSearch();
  }, [setLocation, closeSearch]);

  const submitSearch = useCallback((value: string) => {
    const term = value.trim().replace(/\s+/g, " ");
    if (term) {
      rememberRecentSearch(term);
      trackActivity("search", { meta: { q: term.slice(0, 200) } });
      setLocation(`/browse?search=${encodeURIComponent(term)}`);
    } else {
      setLocation("/browse");
    }
    closeSearch();
  }, [setLocation, closeSearch]);

  const handleClearRecent = useCallback(() => {
    clearRecentSearches();
    setRecentSearches([]);
    setSelectedIndex(-1);
  }, []);

  useEffect(() => {
    if (!open) return;
    setRecentSearches(readRecentSearches());
    setShowSuggestions(true);
    searchInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [predictions, debouncedSearch]);

  useEffect(() => {
    if (selectedIndex < 0 || !suggestionsRef.current) return;
    suggestionsRef.current
      .querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    if (!showSuggestions) return;
    const handleScroll = () => setShowSuggestions(false);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [showSuggestions]);

  // "/" opens global search from anywhere, but never steals focus from a field/editor.
  useEffect(() => {
    if (open) return;
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [open, onOpenChange]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitSearch(search);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const count = hasQuery
        ? predictions.length
        : filteredRecent.length
          ? filteredRecent.length + 1
          : trendingItems.length;
      if (count > 0) {
        event.preventDefault();
        setShowSuggestions(true);
        setSelectedIndex((current) =>
          event.key === "ArrowDown"
            ? (current + 1) % count
            : current <= 0 ? count - 1 : current - 1,
        );
      }
      return;
    }

    if (event.key === "Enter" && selectedIndex >= 0) {
      if (hasQuery && predictions[selectedIndex]) {
        event.preventDefault();
        navigateTo(predictions[selectedIndex].href);
      } else if (hasQuery) {
        event.preventDefault();
        submitSearch(search);
      } else if (!hasQuery && filteredRecent[selectedIndex]) {
        event.preventDefault();
        submitSearch(filteredRecent[selectedIndex]);
      } else if (!hasQuery && filteredRecent.length && selectedIndex === filteredRecent.length) {
        event.preventDefault();
        handleClearRecent();
      } else if (!hasQuery && !filteredRecent.length && trendingItems[selectedIndex]) {
        event.preventDefault();
        navigateTo(trendingItems[selectedIndex].href);
      }
      return;
    }

    if (event.key === "Escape") closeSearch();
  };

  const suggestionsPending = query !== debouncedSearch || predictionsLoading;
  const activeDescendant = selectedIndex >= 0 ? `${listboxId}-option-${selectedIndex}` : undefined;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="nav-btn group"
        aria-label="Open search"
        title="Search ( / )"
        aria-keyshortcuts="/"
      >
        <Search className="relative z-10 h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="relative flex items-center">
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            ref={searchInputRef}
            type="search"
            role="combobox"
            aria-label="Search recordings, performers, and tags"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls={listboxId}
            aria-activedescendant={activeDescendant}
            aria-keyshortcuts="ArrowDown ArrowUp Enter Escape"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search recordings, performers, tags..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 180)}
            onKeyDown={handleKeyDown}
            className="h-9 w-36 rounded-full border border-border/50 bg-secondary pl-8 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40 focus:border-primary/40 min-[380px]:w-44 sm:w-64 dark:bg-white/[0.08]"
          />
          {showSuggestions && (
            <div
              ref={suggestionsRef}
              id={listboxId}
              role="listbox"
              aria-label="Search suggestions"
              className="glass-dropdown absolute right-0 top-full z-50 mt-1.5 max-h-[70vh] w-[calc(100vw-2rem)] min-w-[280px] overflow-y-auto overflow-x-hidden rounded-lg animate-in fade-in zoom-in-95 duration-150 sm:w-[min(420px,calc(100vw-2rem))]"
            >
              {hasQuery ? (
                <>
                  {suggestionsPending && predictions.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground/60">
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Finding matches…
                    </div>
                  ) : predictions.length ? (
                    <div>
                      {(["performer", "recording", "tag"] as const).map((type) => {
                        const group = predictions.filter((item) => item.type === type);
                        if (!group.length) return null;
                        const Icon = type === "performer" ? User : type === "tag" ? Tag : Clapperboard;
                        const label = type === "performer" ? "Performers" : type === "recording" ? "Recordings" : "Tags";
                        return (
                          <section key={type}>
                            <div className="flex items-center gap-1.5 bg-secondary px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 dark:bg-white/[0.06]">
                              <Icon className="h-3 w-3" /> {label}
                            </div>
                            {group.map((item) => {
                              const index = predictions.indexOf(item);
                              return (
                                <button
                                  key={`${item.type}-${item.label}`}
                                  id={`${listboxId}-option-${index}`}
                                  type="button"
                                  role="option"
                                  aria-selected={selectedIndex === index}
                                  data-index={index}
                                  onMouseDown={() => navigateTo(item.href)}
                                  onMouseEnter={() => setSelectedIndex(index)}
                                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-xs transition-colors ${selectedIndex === index ? "bg-secondary text-foreground dark:bg-white/[0.12]" : "text-muted-foreground hover:bg-secondary/30 hover:text-foreground dark:hover:bg-white/5"}`}
                                >
                                  {item.image_url ? (
                                    <span className="h-8 w-8 shrink-0 overflow-hidden rounded bg-secondary">
                                      <img src={proxyImageUrl(item.image_url) ?? ""} alt="" className="h-full w-full object-cover" loading="lazy" />
                                    </span>
                                  ) : (
                                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${type === "performer" ? "rounded-full bg-primary/10 text-primary/60" : type === "tag" ? "rounded-full bg-amber-500/10 text-amber-500/60" : "bg-primary/10 text-primary/60"}`}>
                                      <Icon className="h-3.5 w-3.5" />
                                    </span>
                                  )}
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">
                                      {type === "tag" && <span className="text-muted-foreground/50">#</span>}
                                      {highlightMatch(item.label, search)}
                                    </span>
                                    {item.subtitle && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/50">{item.subtitle}</span>}
                                  </span>
                                  <span className="shrink-0 text-[9px] text-muted-foreground/30">↵</span>
                                </button>
                              );
                            })}
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-4">
                      <p className="text-xs text-muted-foreground">No quick matches for “{debouncedSearch}”.</p>
                      <button type="submit" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                        Search all recordings <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {predictions.length > 0 && (
                    <div className="flex items-center justify-between border-t border-border/30 px-3 py-2 text-[9px] text-muted-foreground/50">
                      <span>{suggestionsPending || predictionsFetching ? "Updating matches…" : "Press Enter to search all recordings"}</span>
                      <span>↑↓ to navigate · Esc to close</span>
                    </div>
                  )}
                </>
              ) : filteredRecent.length ? (
                <>
                  <div className="flex items-center justify-between bg-secondary px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 dark:bg-white/[0.06]">
                    <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Recent searches</span>
                    <button
                      type="button"
                      id={`${listboxId}-option-${filteredRecent.length}`}
                      role="option"
                      aria-selected={selectedIndex === filteredRecent.length}
                      data-index={filteredRecent.length}
                      onMouseDown={(event) => { event.preventDefault(); handleClearRecent(); }}
                      onMouseEnter={() => setSelectedIndex(filteredRecent.length)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] hover:text-foreground"
                    >
                      <Trash2 className="h-2.5 w-2.5" /> Clear
                    </button>
                  </div>
                  {filteredRecent.map((term, index) => (
                    <button
                      key={term}
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selectedIndex === index}
                      data-index={index}
                      onMouseDown={() => submitSearch(term)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors ${selectedIndex === index ? "bg-secondary text-foreground dark:bg-white/[0.08]" : "text-muted-foreground hover:bg-secondary/30 hover:text-foreground"}`}
                    >
                      <Clock className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      <span className="flex-1 truncate">{term}</span>
                      <span className="text-[9px] text-muted-foreground/30">↵</span>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 bg-secondary px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 dark:bg-white/[0.06]">
                    <TrendingUp className="h-3 w-3" /> Trending now
                  </div>
                  {trendingItems.length ? trendingItems.map((item, index) => (
                    <button
                      key={item.href}
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selectedIndex === index}
                      data-index={index}
                      onMouseDown={() => navigateTo(item.href)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors ${selectedIndex === index ? "bg-secondary text-foreground dark:bg-white/[0.08]" : "text-muted-foreground hover:bg-secondary/30 hover:text-foreground"}`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/5">{item.icon}</span>
                      <span className="flex-1 truncate">{item.label}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                    </button>
                  )) : <p className="px-3 py-3 text-xs text-muted-foreground/50">Start typing to search the archive.</p>}
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={closeSearch}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-secondary/50 hover:text-foreground dark:hover:bg-white/5"
          aria-label="Close search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
