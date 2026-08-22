import React from 'react';
import PropTypes from 'prop-types';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box, IconButton, List, ListItem, ListItemText } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

function SortableRow({ item, index, total, disabled, onMove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(item.id) });
  return (
    <ListItem
      ref={setNodeRef}
      divider
      sx={{ transform: CSS.Transform.toString(transform), transition, bgcolor: isDragging ? 'action.selected' : 'background.paper' }}
      secondaryAction={(
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton aria-label={`Move ${item.label} up`} size="small" disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)}><KeyboardArrowUpIcon /></IconButton>
          <IconButton aria-label={`Move ${item.label} down`} size="small" disabled={disabled || index === total - 1} onClick={() => onMove(index, index + 1)}><KeyboardArrowDownIcon /></IconButton>
        </Box>
      )}
    >
      <IconButton aria-label={`Drag ${item.label}`} size="small" disabled={disabled} {...attributes} {...listeners}><DragIndicatorIcon /></IconButton>
      <ListItemText primary={`${index + 1}. ${item.label}`} secondary={item.secondary} />
    </ListItem>
  );
}

SortableRow.propTypes = {
  item: PropTypes.shape({ id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired, label: PropTypes.string.isRequired, secondary: PropTypes.string }),
  index: PropTypes.number.isRequired, total: PropTypes.number.isRequired, disabled: PropTypes.bool, onMove: PropTypes.func.isRequired,
};

/** Accessible sortable list with explicit buttons for keyboard and touch fallback. */
export default function SortableTeamList({ items, onChange, disabled = false }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const move = (from, to) => onChange(arrayMove(items, from, to));
  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => String(item.id) === String(active.id));
    const to = items.findIndex((item) => String(item.id) === String(over.id));
    if (from >= 0 && to >= 0) move(from, to);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => String(item.id))} strategy={verticalListSortingStrategy}>
        <List dense disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          {items.map((item, index) => <SortableRow key={item.id} item={item} index={index} total={items.length} disabled={disabled} onMove={move} />)}
        </List>
      </SortableContext>
    </DndContext>
  );
}

SortableTeamList.propTypes = { items: PropTypes.array.isRequired, onChange: PropTypes.func.isRequired, disabled: PropTypes.bool };
