import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronDownIcon, GripVerticalIcon, MoveHorizontalIcon } from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const DroppableColumn = memo(function DroppableColumn({
  id,
  title,
  description,
  count,
  className,
  summary,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  count: number;
  className?: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[20rem] min-w-[19rem] flex-1 snap-start flex-col rounded-2xl border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(246,246,246,0.92))] p-3 shadow-xs transition-all ${
        isOver ? "border-primary/40 ring-2 ring-primary/20" : ""
      } ${className ?? ""}`}
    >
      <div className="sticky top-0 z-10 mb-3 rounded-xl bg-background/80 px-1 py-1.5 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {title}
            </h3>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {description ?? "Coluna do quadro"}
            </p>
          </div>
          <Badge variant="secondary" className="tabular-nums">
            {count}
          </Badge>
        </div>
        {summary ? <div className="mt-2 flex flex-wrap gap-1.5">{summary}</div> : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {count === 0 ? (
          <div className="flex min-h-[8rem] items-center justify-center rounded-xl border border-dashed border-border bg-muted/25 px-4 text-center text-sm text-muted-foreground">
            Solte um cartao aqui ou use a acao de alterar status.
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
});

const DraggableCard = memo(function DraggableCard({
  id,
  disabled,
  useDragOverlay,
  children,
}: {
  id: string;
  disabled?: boolean;
  useDragOverlay?: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled,
  });
  const hideSource = Boolean(useDragOverlay && isDragging);
  const style = hideSource
    ? undefined
    : transform
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
      : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl border border-border/80 bg-card p-3 text-left shadow-sm outline-none ring-ring/50 transition-all focus-visible:ring-2 ${
        hideSource
          ? "pointer-events-none opacity-0"
          : `${isDragging ? "z-10 scale-[0.99] opacity-60 shadow-lg" : "hover:-translate-y-0.5 hover:shadow-md"} ${
              disabled ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing"
            }`
      }`}
      {...listeners}
      {...attributes}
    >
      <div className="mb-3 flex items-center justify-between gap-2 text-muted-foreground">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em]">
          <GripVerticalIcon className="size-3.5" />
          <span>Cartao</span>
        </div>
        <MoveHorizontalIcon className="size-3.5" />
      </div>
      {children}
    </article>
  );
});

export type KanbanColumnDef = {
  id: string;
  title: string;
  description?: string;
  className?: string;
};
export type KanbanMoveOption = { id: string; title: string };

export function KanbanBoard<T extends { id: string }>({
  columns,
  items,
  getColumnId,
  renderCard,
  onMove,
  disabled,
  ariaLabel = "Quadro Kanban",
  getMoveOptions,
  moveActionLabel = "Alterar status",
  renderColumnSummary,
}: {
  columns: KanbanColumnDef[];
  items: T[];
  getColumnId: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onMove: (item: T, toColumnId: string) => Promise<void>;
  disabled?: boolean;
  ariaLabel?: string;
  getMoveOptions?: (item: T) => KanbanMoveOption[];
  moveActionLabel?: string;
  renderColumnSummary?: (args: {
    column: KanbanColumnDef;
    items: T[];
    allItems: T[];
  }) => ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const c of columns) {
      map.set(c.id, []);
    }
    for (const item of items) {
      const col = getColumnId(item);
      const list = map.get(col);
      if (list) {
        list.push(item);
      } else {
        map.set(col, [item]);
      }
    }
    return map;
  }, [columns, items, getColumnId]);

  const activeItem = useMemo(
    () => (activeId ? items.find((i) => i.id === activeId) ?? null : null),
    [activeId, items],
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || disabled) return;
    const item = items.find((i) => i.id === active.id);
    if (!item) return;
    const targetCol = String(over.id);
    const fromCol = getColumnId(item);
    if (fromCol === targetCol) return;
    await onMove(item, targetCol);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={(e) => void handleDragEnd(e)}
    >
      <div
        className="rounded-[1.75rem] border border-border/70 bg-muted/20 p-3"
        role="region"
        aria-label={ariaLabel}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-sm font-medium text-foreground">{ariaLabel}</p>
          <p className="text-xs text-muted-foreground">
            Arraste entre colunas ou use a acao de status em cada cartao.
          </p>
        </div>

        <div className="flex snap-x gap-4 overflow-x-auto pb-2">
          {columns.map((col) => {
            const columnItems = itemsByColumn.get(col.id) ?? [];
            return (
              <DroppableColumn
                key={col.id}
                id={col.id}
                title={col.title}
                description={col.description}
                count={columnItems.length}
                className={col.className}
                summary={
                  renderColumnSummary
                    ? renderColumnSummary({
                        column: col,
                        items: columnItems,
                        allItems: items,
                      })
                    : undefined
                }
              >
                {columnItems.map((item) => (
                  <DraggableCard
                    key={item.id}
                    id={item.id}
                    disabled={disabled}
                    useDragOverlay
                  >
                    <div className="space-y-3">
                      {renderCard(item)}
                      {getMoveOptions ? (
                        <div
                          className="flex items-center justify-end border-t border-border/70 pt-3"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={disabled}
                                aria-label={moveActionLabel}
                              >
                                {moveActionLabel}
                                <ChevronDownIcon className="size-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>{moveActionLabel}</DropdownMenuLabel>
                              {getMoveOptions(item).map((option) => (
                                <DropdownMenuItem
                                  key={option.id}
                                  disabled={option.id === getColumnId(item) || disabled}
                                  onSelect={() => void onMove(item, option.id)}
                                >
                                  {option.title}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : null}
                    </div>
                  </DraggableCard>
                ))}
              </DroppableColumn>
            );
          })}
        </div>
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 180,
          easing: "cubic-bezier(0.25, 1, 0.5, 1)",
        }}
      >
        {activeItem ? (
          <div className="max-w-[19rem] rounded-2xl border border-primary/30 bg-card p-3 text-left shadow-xl ring-2 ring-primary/20">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <GripVerticalIcon className="size-3.5" />
              <span>Em movimento</span>
            </div>
            {renderCard(activeItem)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
