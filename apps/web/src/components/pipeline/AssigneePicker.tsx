import type { ReactNode } from "react";

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { User } from "./api";

/**
 * Who a ticket belongs to. One picker for every place that asks: a new task, the
 * ticket's own header, and handing a leaving member's tickets to someone else.
 */
export function AssigneePicker({
  users,
  value,
  onChange,
  placeholder = "Unassigned",
  note,
  disabled,
  children,
}: {
  users: User[];
  /** A person's id, null for nobody, undefined while nothing has been chosen yet. */
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  /** Shown while nothing has been chosen. */
  placeholder?: string;
  /** One line above the choices, for a consequence worth knowing before picking. */
  note?: string | null;
  disabled?: boolean;
  /** The closed picker, when it should not be a field — the face in a ticket's header. */
  children?: ReactNode;
}) {
  const current = users.find((u) => u.id === value)?.name ?? "Unassigned";
  return (
    <Select
      value={value === undefined ? null : (value ?? "__none")}
      onValueChange={(v) => onChange(v === "__none" ? null : String(v))}
      {...(disabled ? { disabled } : {})}
    >
      {children ? (
        <SelectTrigger
          size="xs"
          variant="ghost"
          aria-label={`Assignee: ${current}. Change`}
          className="h-5 shrink-0 px-1 sm:h-5"
        >
          {children}
        </SelectTrigger>
      ) : (
        <SelectTrigger size="sm" aria-label="Assignee">
          <SelectValue>{value === undefined ? placeholder : current}</SelectValue>
        </SelectTrigger>
      )}
      <SelectPopup alignItemWithTrigger={false} matchTriggerWidth={!children}>
        {note ? (
          <p className="max-w-64 px-2 pt-1 pb-1.5 text-[11px] leading-[1.45] text-muted-foreground">
            {note}
          </p>
        ) : null}
        <SelectItem value="__none">Unassigned</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
