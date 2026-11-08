import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { resolveApiPath } from "@/lib/api-base";
import {
  Shield, ArrowsClockwise, CheckCircle, XCircle, Clock, Warning,
  User, LinkSimple, FileText, CaretDown, CaretUp, Tray,
  ArrowLeft, Trash, Funnel, Lock,
} from "@phosphor-icons/react";
import { formatRelativeTime } from "@/lib/formatters";
import { safeExternalUrl } from "@/lib/safe-url";

interface AdminRequest {
  id: number | null;
  performer_username: string | null;
  stream_link: string | null;
  notes: string | null;
  priority: string | null;
  status: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending:  { label: "Pending",   className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  approved: { label: "Approved",  className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected: { label: "Rejected",  className: "bg-red-500/15 text-red-400 border-red-500/30" },
  done:     { label: "Done",      className: "bg-primary/15 text-primary border-primary/30" },
};

const PRIORITY_STYLES: Record<string, string> = {
  low:    "text-muted-foreground",
  normal: "text-foreground",
  high:   "text-orange-400 font-semibold",
};

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "done";

export default function AdminPage() {
  const { user, loading, role } = useAuth();
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);

  const isAdmin = role === "admin" || role === "moderator";

  const loadRequests = useCallback(async () => {
    setPageLoading(true);
    setError(null);
    try {
      const res = await fetch(resolveApiPath("/api/requests"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load requests");
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && isAdmin) loadRequests();
    else if (!loading) setPageLoading(false);
  }, [loading, isAdmin, loadRequests]);

  const updateStatus = async (id: number, status: string) => {
    setUpdating(id);
    try {
      const res = await fetch(resolveApiPath(`/api/requests/${id}/status`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch {
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } finally {
      setUpdating(null);
    }
  };

  const deleteRequest = async (id: number) => {
    setRequests((prev) => prev.filter((r) => r.id !== id));
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!user || !isAdmin) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 text-center max-w-sm">
          <Lock size={36} weight="duotone" className="text-muted-foreground/20 mx-auto mb-6" />
          <h1 className="text-xl font-bold mb-2">Admin access required</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {!user
              ? "Sign in with an admin account to access this page."
              : "Your account doesn't have admin privileges."}
          </p>
          <Link href={user ? "/" : "/login"}>
            <span className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 rounded-lg transition-colors">
              {user ? "Go Home" : "Sign In"}
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  const filtered = requests.filter((r) =>
    statusFilter === "all" ? true : r.status === statusFilter,
  );

  const counts: Record<StatusFilter, number> = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
    done: requests.filter((r) => r.status === "done").length,
  };

  const filterTabs: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pending", label: "Pending" },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
    { id: "done", label: "Done" },
  ];

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-4xl">
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
              <Shield size={15} weight="duotone" className="text-primary" />
              <span>Admin</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Recording Requests
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Review, approve or reject user-submitted recording requests
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={loadRequests}
              disabled={pageLoading}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all rounded-lg disabled:opacity-50"
            >
              <ArrowsClockwise size={14} className={pageLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-6">
          {filterTabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setStatusFilter(id)}
              className={`p-3 border rounded-lg text-left transition-all ${
                statusFilter === id
                  ? "border-primary/60"
                  : "border-border/40 hover:border-border/70"
              }`}
            >
              <div className={`text-lg font-bold tabular-nums ${statusFilter === id ? "text-primary" : "text-foreground"}`}>
                {counts[id]}
              </div>
              <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
            </button>
          ))}
        </div>

        <div className="flex gap-1 mb-4 items-center">
          <Funnel size={14} className="text-muted-foreground/50 mr-1" />
          {filterTabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setStatusFilter(id)}
              className={`px-3 py-1 text-xs rounded-lg transition-all border ${
                statusFilter === id
                  ? "border-primary/60 text-primary"
                  : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {label}
              {counts[id] > 0 && (
                <span className={`ml-1.5 ${                statusFilter === id ? "text-primary/60" : "text-muted-foreground/50"}`}>
                  {counts[id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive mb-4">
            <Warning size={16} weight="duotone" className="shrink-0" />
            {error}
          </div>
        )}

        {pageLoading && !requests.length ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-secondary/30 border border-border/30 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center border border-dashed border-border/40 rounded-2xl">
            <Tray size={36} weight="duotone" className="text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              {statusFilter === "all" ? "No requests submitted yet." : `No ${statusFilter} requests.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((req) => {
              const safeStreamLink = safeExternalUrl(req.stream_link);
              const isExpanded = expandedId === req.id;
              const statusStyle = STATUS_STYLES[req.status] ?? STATUS_STYLES.pending;
              const priorityStyle = PRIORITY_STYLES[req.priority ?? "normal"] ?? "";

              return (
                <div
                  key={req.id ?? req.created_at}
                  className="border border-border/40 hover:border-border/70 rounded-xl transition-all"
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${statusStyle.className}`}>
                      {statusStyle.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {req.performer_username && (
                          <span className="text-sm font-semibold flex items-center gap-1">
                            <User size={12} className="text-muted-foreground/50" />
                            {req.performer_username}
                          </span>
                        )}
                        {req.stream_link && !req.performer_username && (
                          safeStreamLink ? (
                            <a
                              href={safeStreamLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-semibold text-primary hover:underline flex items-center gap-1 truncate max-w-xs"
                            >
                              <LinkSimple size={12} className="shrink-0" />
                              {req.stream_link}
                            </a>
                          ) : (
                            <span className="text-sm font-semibold text-muted-foreground truncate max-w-xs">
                              {req.stream_link}
                            </span>
                          )
                        )}
                        {req.priority && req.priority !== "normal" && (
                          <span className={`text-[11px] ${priorityStyle}`}>[{req.priority}]</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground/60">
                        <Clock size={12} />
                        {formatRelativeTime(req.created_at)}
                        {req.notes && (
                          <>
                            <span>·</span>
                            <span className="truncate max-w-xs">{req.notes}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {req.status === "pending" && req.id != null && (
                        <>
                          <button
                            onClick={() => updateStatus(req.id!, "approved")}
                            disabled={updating === req.id}
                            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-green-400 hover:bg-green-400/10 transition-colors rounded"
                            title="Approve"
                          >
                            <CheckCircle size={16} weight="duotone" />
                          </button>
                          <button
                            onClick={() => updateStatus(req.id!, "rejected")}
                            disabled={updating === req.id}
                            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors rounded"
                            title="Reject"
                          >
                            <XCircle size={16} weight="duotone" />
                          </button>
                        </>
                      )}
                      {req.status === "approved" && req.id != null && (
                        <button
                          onClick={() => updateStatus(req.id!, "done")}
                          disabled={updating === req.id}
                          className="h-7 px-3 text-[11px] font-medium border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg"
                        >
                          Mark Done
                        </button>
                      )}
                      <button
                        onClick={() => req.id != null && deleteRequest(req.id)}
                        className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors rounded"
                        title="Remove"
                      >
                        <Trash size={14} />
                      </button>
                      {(req.notes || req.stream_link) && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : req.id)}
                          className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded"
                        >
                          {isExpanded ? <CaretUp size={16} /> : <CaretDown size={16} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border/30 pt-3 space-y-2">
                      {req.stream_link && (
                        <div className="flex items-start gap-2 text-xs">
                          <LinkSimple size={14} className="text-muted-foreground/50 mt-0.5 shrink-0" />
                          {safeStreamLink ? (
                            <a
                              href={safeStreamLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline break-all"
                            >
                              {req.stream_link}
                            </a>
                          ) : (
                            <span className="text-muted-foreground break-all">{req.stream_link}</span>
                          )}
                        </div>
                      )}
                      {req.notes && (
                        <div className="flex items-start gap-2 text-xs">
                          <FileText size={14} className="text-muted-foreground/50 mt-0.5 shrink-0" />
                          <p className="text-muted-foreground leading-relaxed">{req.notes}</p>
                        </div>
                      )}
                      {req.id != null && req.status !== "done" && (
                        <div className="flex gap-2 pt-2 flex-wrap">
                          {req.status !== "approved" && (
                            <button
                              onClick={() => updateStatus(req.id!, "approved")}
                              className="h-7 px-3 text-[11px] font-medium border border-green-500/40 text-green-400 hover:border-green-500/60 transition-colors rounded-lg"
                            >
                              Approve
                            </button>
                          )}
                          {req.status !== "rejected" && (
                            <button
                              onClick={() => updateStatus(req.id!, "rejected")}
                              className="h-7 px-3 text-[11px] font-medium border border-red-500/40 text-red-400 hover:border-red-500/60 transition-colors rounded-lg"
                            >
                              Reject
                            </button>
                          )}
                          {req.status === "approved" && (
                            <button
                              onClick={() => updateStatus(req.id!, "done")}
                              className="h-7 px-3 text-[11px] font-medium border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg"
                            >
                              Mark Done
                            </button>
                          )}
                          <button
                            onClick={() => updateStatus(req.id!, "pending")}
                            className="h-7 px-3 text-[11px] font-medium border border-border/50 text-muted-foreground hover:text-foreground transition-colors rounded-lg"
                          >
                            Reset to Pending
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-border/30 text-[11px] text-muted-foreground/40 text-center">
          Admin panel — handle with care
        </div>
      </div>
    </Layout>
  );
}
