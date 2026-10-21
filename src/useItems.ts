import { useCallback, useRef, useState } from 'react';
import { initialItems, type ItemState } from './items';

export function useItems() {
  const [items, setItems] = useState(initialItems);
  const itemsRef = useRef(items);
  // Transactions run once outside React's state updater; consecutive events see the committed result.
  const updateItems = useCallback((update: (current: ItemState) => ItemState, notify = true) => {
    const next = update(itemsRef.current);
    itemsRef.current = next;
    if (notify) setItems(next);
    return next;
  }, []);
  const publishItems = useCallback(() => setItems(itemsRef.current), []);
  return { items, itemsRef, updateItems, publishItems };
}
