import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, User, FileText, ClipboardList, Building2, Loader2, HelpCircle } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

// ── API shape ─────────────────────────────────────────────────────────────────

interface EmpResult {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  jobTitle?: string | null;
  employeeDisplayId?: string | null;
  companyId: string;
  status?: string;
}

interface DocResult {
  id: string;
  documentName: string;
  documentType: string;
  employeeId: string;
  employeeName: string;
  companyId: string;
}

interface TaskResult {
  id: string;
  taskName: string;
  status: string;
  employeeId: string;
  employeeName: string;
  companyId: string;
  category: string;
}

interface CompanyResult {
  id: string;
  name: string;
  status: string;
}

interface SearchResults {
  employees: EmpResult[];
  documents: DocResult[];
  tasks: TaskResult[];
  companies: CompanyResult[];
  suggestions: EmpResult[];   // fuzzy / "Did you mean?" candidates
}

const EMPTY: SearchResults = { employees: [], documents: [], tasks: [], companies: [], suggestions: [] };

function hasResults(r: SearchResults) {
  return r.employees.length > 0 || r.documents.length > 0 || r.tasks.length > 0 || r.companies.length > 0;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, navigate] = useLocation();

  // ⌘K / Ctrl+K opens the palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Reset query when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(EMPTY);
      setLoading(false);
    }
  }, [open]);

  // Debounced search fetch
  const fetchResults = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(EMPTY); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as SearchResults;
        setResults({ ...EMPTY, ...data });
      } else {
        setResults(EMPTY);
      }
    } catch {
      setResults(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleValueChange = useCallback((val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 2) { setResults(EMPTY); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(() => void fetchResults(val), 250);
  }, [fetchResults]);

  const go = useCallback((href: string) => {
    setOpen(false);
    navigate(href);
  }, [navigate]);

  const noExactResults = query.length >= 2 && !loading && !hasResults(results);
  const hasSuggestions = results.suggestions.length > 0;

  return (
    <>
      {/* Trigger — looks like the original static bar */}
      <button
        onClick={() => setOpen(true)}
        className="relative hidden md:flex items-center w-72 h-9 pl-9 pr-4 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-400 hover:border-gray-300 hover:bg-gray-100 transition-colors text-left"
        aria-label="Open search"
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <span className="flex-1 truncate">Search employees, documents, policies…</span>
        <kbd className="text-[10px] text-gray-300 font-mono hidden xl:block shrink-0">⌘ K</kbd>
      </button>

      {/* Command palette
          filter={() => 1} disables cmdk's built-in text filter so it never hides
          items that our server-side search already matched. Without this, cmdk
          re-filters the rendered items against the input and can silently drop
          results when the query doesn't appear verbatim in the item's value prop. */}
      <CommandDialog open={open} onOpenChange={setOpen} filter={() => 1}>
        <CommandInput
          placeholder="Search employees, documents, tasks…"
          value={query}
          onValueChange={handleValueChange}
        />
        <CommandList>
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          )}

          {/* Prompt */}
          {!loading && query.length < 2 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </div>
          )}

          {/* No exact results — show fuzzy suggestions if available */}
          {!loading && noExactResults && !hasSuggestions && (
            <CommandEmpty>No results for &ldquo;{query}&rdquo;</CommandEmpty>
          )}

          {!loading && noExactResults && hasSuggestions && (
            <>
              <div className="px-4 pt-4 pb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                <span>No exact match — did you mean…?</span>
              </div>
              <CommandGroup heading="Suggestions">
                {results.suggestions.map(emp => (
                  <CommandItem
                    key={`sug-${emp.id}`}
                    value={`sug-${emp.id}`}
                    onSelect={() => go(`/people/${emp.id}`)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <User className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="font-medium">{emp.firstName} {emp.lastName}</span>
                    {emp.employeeDisplayId && (
                      <span className="text-xs text-muted-foreground font-mono">{emp.employeeDisplayId}</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto truncate max-w-40">
                      {emp.jobTitle ?? emp.position}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* Employees */}
          {!loading && results.employees.length > 0 && (
            <CommandGroup heading="Employees">
              {results.employees.map(emp => (
                <CommandItem
                  key={emp.id}
                  value={`emp-${emp.id}`}
                  onSelect={() => go(`/people/${emp.id}`)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <User className="h-3.5 w-3.5 text-[#284362] shrink-0" />
                  <span className="font-medium">{emp.firstName} {emp.lastName}</span>
                  {emp.employeeDisplayId && (
                    <span className="text-xs text-muted-foreground font-mono">{emp.employeeDisplayId}</span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto truncate max-w-40">
                    {emp.jobTitle ?? emp.position}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!loading && results.employees.length > 0 && results.documents.length > 0 && <CommandSeparator />}

          {/* Documents */}
          {!loading && results.documents.length > 0 && (
            <CommandGroup heading="Documents">
              {results.documents.map(doc => (
                <CommandItem
                  key={doc.id}
                  value={`doc-${doc.id}`}
                  onSelect={() => go(`/people/${doc.employeeId}?tab=documents`)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                  <span className="font-medium truncate">{doc.documentName}</span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {doc.employeeName}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!loading && results.documents.length > 0 && results.tasks.length > 0 && <CommandSeparator />}

          {/* Tasks */}
          {!loading && results.tasks.length > 0 && (
            <CommandGroup heading="Onboarding Tasks">
              {results.tasks.map(task => (
                <CommandItem
                  key={task.id}
                  value={`task-${task.id}`}
                  onSelect={() => go(`/people/${task.employeeId}?tab=onboarding`)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <ClipboardList className="h-3.5 w-3.5 text-teal-500 shrink-0" />
                  <span className="font-medium truncate">{task.taskName}</span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {task.employeeName}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!loading && results.tasks.length > 0 && results.companies.length > 0 && <CommandSeparator />}

          {/* Companies (super_admin only) */}
          {!loading && results.companies.length > 0 && (
            <CommandGroup heading="Companies">
              {results.companies.map(co => (
                <CommandItem
                  key={co.id}
                  value={`co-${co.id}`}
                  onSelect={() => go(`/clients/${co.id}`)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Building2 className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                  <span className="font-medium">{co.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0 capitalize">{co.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
