import { Button } from "@/components/ui/button";

interface LayoutManagerProps {
  onSave: () => void;
  onLoad: () => void;
  onClose: () => void;
}

export function LayoutManager({ onSave, onLoad, onClose }: LayoutManagerProps) {
  return (
    <div className="absolute right-3 top-14 z-50 w-48 rounded-lg border border-border bg-popover p-2 shadow-lg">
      <div className="mb-2 flex items-center justify-between px-2">
        <h3 className="text-sm font-semibold">Layouts</h3>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>×</Button>
      </div>
      <div className="flex flex-col gap-1">
        <Button variant="ghost" className="justify-start text-xs h-8" onClick={() => { onSave(); onClose(); }}>
          Save current layout
        </Button>
        <Button variant="ghost" className="justify-start text-xs h-8" onClick={() => { onLoad(); onClose(); }}>
          Load saved layout
        </Button>
      </div>
    </div>
  );
}
