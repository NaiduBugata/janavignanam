import { useState, useMemo, useRef, useCallback } from "react";
import {
  ASSEMBLY_CONSTITUENCIES,
  MAP_VIEWBOX,
  MAP_OUTER_BORDER,
  MAP_INTERNAL_BORDER,
  MAP_COLORS,
  type AssemblyConstituency,
} from "./constituency-data";
import { RotateCcw, ZoomIn, ZoomOut, Check, Info } from "lucide-react";

interface ConstituencyMapProps {
  selectedAssembly: string;
  selectedDivision: string;
  assemblyCounts: Record<string, number>;
  totalAll: number;
  onSelectAssembly: (name: string) => void;
  onClearSelection: () => void;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  constituency: AssemblyConstituency | null;
}

export function ConstituencyMap({
  selectedAssembly,
  selectedDivision,
  assemblyCounts,
  totalAll,
  onSelectAssembly,
  onClearSelection,
}: ConstituencyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    constituency: null,
  });

  // Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const activeNormalized = selectedAssembly.trim().toLowerCase();
  const divisionNormalized = selectedDivision.trim().toLowerCase();

  const selectedConstituency = useMemo(() => {
    if (!activeNormalized) return null;
    return ASSEMBLY_CONSTITUENCIES.find((c) => c.name.toLowerCase() === activeNormalized) || null;
  }, [activeNormalized]);

  const handleMouseMove = useCallback((e: React.MouseEvent, c: AssemblyConstituency) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltip({
      visible: true,
      x,
      y,
      constituency: c,
    });
  }, []);

  const handleMouseEnter = useCallback((c: AssemblyConstituency) => {
    setHoveredId(c.id);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null);
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleZoom = (delta: number) => {
    setZoomLevel((prev) => Math.min(Math.max(0.8, prev + delta), 2.5));
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only primary button
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleContainerMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="relative flex flex-col rounded-2xl border bg-card p-4 shadow-sm transition-all">
      {/* Map Header / Control Bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Assembly Constituencies
          </span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            · 7 Segments (Palnadu)
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClearSelection}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${
              !selectedAssembly
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All Constituencies
          </button>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Zoom controls */}
          <div className="inline-flex rounded-lg border bg-background p-0.5">
            <button
              type="button"
              onClick={() => handleZoom(0.2)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(-0.2)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Reset Zoom"
              aria-label="Reset Zoom"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl bg-white border border-slate-100 flex items-center justify-center min-h-[360px] md:min-h-[460px] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          viewBox={MAP_VIEWBOX.viewBox}
          className="w-full h-auto max-h-[540px] drop-shadow-sm transition-transform duration-100 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel})`,
            transformOrigin: "center center",
            outline: "none",
          }}
        >
          <defs>
            <style>{`
              path, g, svg {
                outline: none !important;
                -webkit-tap-highlight-color: transparent;
              }
              path:focus, g:focus, svg:focus {
                outline: none !important;
              }
            `}</style>
            {/* Clip path preventing any fills from bleeding outside the district boundary */}
            <clipPath id="district-clip">
              <path d={MAP_OUTER_BORDER} />
            </clipPath>
                      {/* Luminous Diagonal Stripe Pattern for Selected Constituency */}
            <pattern
              id="active-stripes"
              width="16"
              height="16"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="16"
                stroke="#FFFFFF"
                strokeWidth="4"
                strokeOpacity="0.45"
              />
            </pattern>
          </defs>

          {/* Group 1: Regional Fills (Clipped inside the outer boundary with zero stroke) */}
          <g clipPath="url(#district-clip)">
            {ASSEMBLY_CONSTITUENCIES.map((c) => {
              const isSelected = activeNormalized === c.name.toLowerCase();
              const isHovered = hoveredId === c.id;
              const matchesDivision =
                !divisionNormalized ||
                divisionNormalized === "all divisions" ||
                c.division.toLowerCase() === divisionNormalized;

              // Opacity logic:
              // - If this constituency is selected, full opacity (1)
              // - If another constituency is selected, dim to 0.32
              // - If division is filtered, non-matching constituencies dim to 0.32
              let opacity = 1;
              if (activeNormalized && !isSelected) {
                opacity = 0.22;
              } else if (divisionNormalized && !matchesDivision) {
                opacity = 0.22;
              }

              return (
                <path
                  key={c.id}
                  d={c.svgPath}
                  fill={isSelected ? c.activeColor : c.color}
                  stroke="none"
                  style={{
                    opacity: isHovered && !isSelected ? Math.min(1, opacity + 0.35) : opacity,
                    filter: isSelected
                      ? "brightness(1.04)"
                      : isHovered
                      ? "brightness(1.08)"
                      : activeNormalized
                      ? "saturate(0.4)"
                      : undefined,
                    outline: "none",
                    transition: "fill 180ms ease, opacity 180ms ease, filter 180ms ease",
                  }}
                  className="cursor-pointer transition-all duration-150 focus:outline-none"
                  tabIndex={0}
                  role="button"
                  aria-label={`${c.name} Assembly Constituency, #${c.acNo}, ${c.division} Division, ${(assemblyCounts[c.name] || 0).toLocaleString()} contacts`}
                  onMouseDown={(e) => {
                    // Prevent default focus ring from appearing around SVG bounding box
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSelected) {
                      onClearSelection();
                    } else {
                      onSelectAssembly(c.name);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (isSelected) {
                        onClearSelection();
                      } else {
                        onSelectAssembly(c.name);
                      }
                    }
                  }}
                  onMouseEnter={() => handleMouseEnter(c)}
                  onMouseMove={(e) => handleMouseMove(e, c)}
                  onMouseLeave={handleMouseLeave}
                />
              );
            })}

                        {/* Luminous Diagonal Stripe Overlay on Selected Constituency */}
            {selectedConstituency && (
              <path
                d={selectedConstituency.svgPath}
                fill="url(#active-stripes)"
                stroke="none"
                className="pointer-events-none"
              />
            )}

            {/* Internal Orange Dividing Lines (Drawn once cleanly between constituencies, never on outer perimeter) */}
            <path
              d={MAP_INTERNAL_BORDER}
              fill="#FB6116"
              stroke="#FB6116"
              strokeWidth={0.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="pointer-events-none"
            />
          </g>

          {/* Group 2: Outer Perimeter Boundary (Solid dark charcoal stroke on top of all fills) */}
          <path
            d={MAP_OUTER_BORDER}
            fill="none"
            stroke={MAP_COLORS.outerBorder}
            strokeWidth={3.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none"
          />

          {/* Group 3: Text Labels Styled Directly from Reference Map */}
          {ASSEMBLY_CONSTITUENCIES.map((c) => {
            const isSelected = activeNormalized === c.name.toLowerCase();
            const matchesDivision =
              !divisionNormalized ||
              divisionNormalized === "all divisions" ||
              c.division.toLowerCase() === divisionNormalized;

            let opacity = 1;
            if (activeNormalized && !isSelected) {
              opacity = 0.4;
            } else if (divisionNormalized && !matchesDivision) {
              opacity = 0.4;
            }

            return (
              <g
                key={`label-${c.id}`}
                transform={`translate(${c.labelPos[0]}, ${c.labelPos[1]})${c.rotation ? ` rotate(${c.rotation})` : ""}`}
                className="pointer-events-none select-none transition-opacity duration-200"
                style={{ opacity, outline: "none" }}
              >
                {/* Active selection badge pill behind text when selected */}
                {isSelected && (
                  <g>
                    {/* Outer ambient glow halo */}
                    <rect
                      x="-71"
                      y="-25"
                      width="142"
                      height="54"
                      rx="12"
                      fill="#0F172A"
                      fillOpacity={0.25}
                    />
                    {/* Main elevated navy badge */}
                    <rect
                      x="-68"
                      y="-23"
                      width="136"
                      height="50"
                      rx="10"
                      fill="#1E3A8A"
                      fillOpacity={0.98}
                      stroke="#FFFFFF"
                      strokeWidth={2}
                      className="drop-shadow-lg"
                    />
                    {/* Active green status beacon */}
                    <circle cx="-52" cy="-2" r="4" fill="#22C55E" />
                  </g>
                )}

                {/* Constituency Name */}
                <text
                  x={isSelected ? "5" : "0"}
                  y="-2"
                  textAnchor="middle"
                  fill={isSelected ? "#FFFFFF" : MAP_COLORS.labelColor}
                  fontSize="18"
                  fontWeight="600"
                  fontFamily="Georgia, Cambria, 'Times New Roman', serif"
                  className="transition-colors"
                >
                  {c.name}
                </text>

                {/* Delimitation Segment Number */}
                <text
                  x={isSelected ? "5" : "0"}
                  y={isSelected ? "18" : "19"}
                  textAnchor="middle"
                  fill={isSelected ? "#FDE68A" : MAP_COLORS.labelColor}
                  fontSize="16"
                  fontWeight="500"
                  fontFamily="Georgia, Cambria, 'Times New Roman', serif"
                  className="tabular-nums transition-colors"
                >
                  {c.acNo}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {tooltip.visible && tooltip.constituency && (
          <div
            className="pointer-events-none absolute z-30 transform -translate-x-1/2 -translate-y-full mb-2 rounded-xl border bg-slate-900/95 px-3.5 py-2.5 text-xs text-white shadow-xl backdrop-blur-sm transition-all"
            style={{
              left: `${tooltip.x}px`,
              top: `${tooltip.y - 12}px`,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full ring-1 ring-white/50"
                style={{ backgroundColor: tooltip.constituency.color }}
              />
              <span className="font-bold text-sm">{tooltip.constituency.name}</span>
              <span className="text-[11px] text-slate-300">
                ({tooltip.constituency.teluguName})
              </span>
            </div>

            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-300">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-semibold text-amber-300">
                Segment #{tooltip.constituency.acNo}
              </span>
              <span>{tooltip.constituency.division} Division</span>
            </div>

            <div className="mt-2 border-t border-slate-700 pt-1.5 flex items-center justify-between gap-5 font-semibold text-emerald-400">
              <span>Verified Contacts:</span>
              <span className="tabular-nums">
                {(assemblyCounts[tooltip.constituency.name] || 0).toLocaleString()}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-slate-400">Click to filter directory</p>
          </div>
        )}

        {/* Active Selection Overlay Indicator */}
        {selectedAssembly && (
          <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-lg bg-card/95 border px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
            <Check className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">Filtered to:</span>
            <span className="font-bold text-foreground">{selectedAssembly}</span>
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-1 text-[11px] text-primary hover:underline font-medium"
            >
              Show all
            </button>
          </div>
        )}
      </div>

      {/* Map Legend Pills (Clickable) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {ASSEMBLY_CONSTITUENCIES.map((c) => {
            const isSelected = activeNormalized === c.name.toLowerCase();
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  if (isSelected) {
                    onClearSelection();
                  } else {
                    onSelectAssembly(c.name);
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all ${
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: isSelected ? c.activeColor : c.color }}
                />
                <span className="font-medium">{c.name}</span>
                <span className="text-[10px] opacity-75 font-serif">({c.acNo})</span>
                <span
                  className={`tabular-nums text-[10px] rounded px-1 ${
                    isSelected
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {(assemblyCounts[c.name] || 0).toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          <span>7 Assembly Constituencies · Palnadu</span>
        </div>
      </div>
    </div>
  );
}
