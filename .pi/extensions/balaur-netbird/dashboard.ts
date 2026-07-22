import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { presentInspect } from "./presenters.mjs";

const TABS = [
  ["Overview", "overview"],
  ["Peers", "peers"],
  ["Groups", "groups"],
  ["Policies", "policies"],
  ["Networks", "networks"],
  ["Routes", "routes"],
  ["DNS", "dns"],
  ["Posture", "posture_checks"],
  ["Events", "events"],
] as const;

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "NetBird operation failed";
  return message
    .replace(/\b(?:Token|Bearer)\s+\S+/gi, "[REDACTED]")
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .slice(0, 300);
}

class NetbirdDashboard {
  private tab = 0;
  private scroll = 0;
  private lines: string[] = [];
  private summary = "";
  private status = "Loading...";
  private loading = false;
  private generation = 0;

  constructor(
    private readonly tui: { requestRender(): void },
    private readonly theme: any,
    private readonly client: any,
    private readonly doctor: () => Promise<string>,
    private readonly close: () => void,
  ) {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.status = "Refreshing...";
    const generation = ++this.generation;
    this.tui.requestRender();
    try {
      const view = TABS[this.tab][1];
      const data = await this.client.inspect({ view });
      if (generation !== this.generation) return;
      const projection = presentInspect(view, data, { maxItems: 200, maxLines: 300, maxLineChars: 500 });
      this.lines = [...projection.lines];
      this.summary = projection.summary;
      this.status = `Updated ${new Date().toLocaleTimeString()}`;
      this.scroll = Math.min(this.scroll, Math.max(0, this.lines.length - 1));
    } catch (error) {
      if (generation !== this.generation) return;
      this.lines = [];
      this.summary = "Unavailable";
      this.status = safeError(error);
    } finally {
      if (generation === this.generation) this.loading = false;
      this.tui.requestRender();
    }
  }

  private selectTab(offset: number): void {
    this.tab = (this.tab + offset + TABS.length) % TABS.length;
    this.scroll = 0;
    this.lines = [];
    this.generation += 1;
    this.loading = false;
    void this.refresh();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.generation += 1;
      this.close();
      return;
    }
    if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) this.selectTab(-1);
    else if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) this.selectTab(1);
    else if (matchesKey(data, Key.up)) this.scroll = Math.max(0, this.scroll - 1);
    else if (matchesKey(data, Key.down)) this.scroll = Math.min(Math.max(0, this.lines.length - 1), this.scroll + 1);
    else if (data === "r" || data === "R") void this.refresh();
    else if (data === "d" || data === "D") {
      if (!this.loading) {
        this.loading = true;
        this.status = "Running doctor...";
        this.tui.requestRender();
        void this.doctor()
          .then((result) => { this.status = result.slice(0, 300); })
          .catch((error) => { this.status = safeError(error); })
          .finally(() => { this.loading = false; this.tui.requestRender(); });
      }
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (width <= 0) return [""];
    const safe = (line: string) => truncateToWidth(line, width, "");
    const tabLine = TABS.map(([label], index) => index === this.tab
      ? this.theme.fg("accent", this.theme.bold(`[${label}]`))
      : this.theme.fg("muted", ` ${label} `)).join(" ");
    const rows = Math.max(10, (process.stdout.rows ?? 24) - 2);
    const bodyRows = Math.max(1, rows - 6);
    const visible = this.lines.slice(this.scroll, this.scroll + bodyRows);
    const output = [
      safe(this.theme.fg("accent", this.theme.bold("NetBird Cloud Dashboard"))),
      safe(tabLine),
      safe(this.theme.fg("muted", this.summary)),
      safe(this.theme.fg("dim", `Status: ${this.status}`)),
      safe(this.theme.fg("dim", "left/right or Tab tabs  up/down scroll  r refresh  d doctor  Esc/q close")),
      "",
      ...visible.map((line) => safe(line)),
    ];
    while (output.length < rows) output.push("");
    return output.slice(0, rows).map(safe);
  }

  invalidate(): void {}
}

export async function openNetbirdDashboard(ctx: any, { client, doctor }: { client: any; doctor: () => Promise<string> }): Promise<void> {
  if (ctx.mode !== "tui") throw new Error("The NetBird dashboard requires interactive TUI mode");
  await ctx.ui.custom((tui: any, theme: any, _keybindings: any, done: (value: undefined) => void) =>
    new NetbirdDashboard(tui, theme, client, doctor, () => done(undefined)));
}
