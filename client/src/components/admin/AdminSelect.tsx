import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../lib/api';
import catalog from './catalog.json';

export type BaseOption = { value: string; label: string };
export type DropdownEntry = BaseOption & { mapsTo: string; hidden: boolean; deleted: boolean };
export type DropdownConfig = { baseOptions: BaseOption[]; entries: DropdownEntry[]; version: number };
type CatalogItem = { key: string; label: string; page: string; options: BaseOption[] };
type ContextValue = {
  configs: Record<string, DropdownConfig>; catalog: CatalogItem[]; loading: boolean; error: string;
  reload: () => Promise<void>; remember: (key: string, options: BaseOption[]) => void;
  accept: (key: string, config: DropdownConfig) => void;
};
const Context = createContext<ContextValue | null>(null);
export const useAdminDropdowns = () => useContext(Context);

export function AdminDropdownProvider({ children }: { children: React.ReactNode }) {
  const [configs, setConfigs] = useState<Record<string, DropdownConfig>>({});
  const [discovered, setDiscovered] = useState<Record<string, BaseOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/admin-dropdowns'); setConfigs(data.configs || {}); setError(''); }
    catch { setError('Dropdown settings could not load. Existing options remain available.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const remember = useCallback((key: string, options: BaseOption[]) => {
    if (!options.length) return;
    setDiscovered(current => {
      const merged = new Map((current[key] || []).map(option => [option.value, option]));
      for (const option of options) merged.set(option.value, option);
      const next = [...merged.values()];
      return JSON.stringify(current[key]) === JSON.stringify(next) ? current : { ...current, [key]: next };
    });
  }, []);
  const accept = useCallback((key: string, config: DropdownConfig) => setConfigs(current => ({ ...current, [key]: config })), []);
  const items = useMemo(() => catalog.map(item => ({ ...item, options: [...new Map([...item.options, ...(configs[item.key]?.baseOptions || []), ...(discovered[item.key] || [])].map(option => [option.value, option])).values()] })), [configs, discovered]);
  const value = useMemo(() => ({ configs, catalog: items, loading, error, reload, remember, accept }), [configs, items, loading, error, reload, remember, accept]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function text(node: React.ReactNode): string {
  return React.Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : React.isValidElement<{ children?: React.ReactNode }>(child) ? text(child.props.children) : '').join('');
}
function collect(node: React.ReactNode, list: Array<{ option: BaseOption; element: React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>> }> = []) {
  React.Children.forEach(node, child => {
    if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode }>(child)) return;
    if (child.type === 'option') list.push({ option: { value: String(child.props.value ?? text(child.props.children)), label: text(child.props.children) || 'Choose…' }, element: child });
    else if (child.type === React.Fragment || child.type === 'optgroup') collect(child.props.children, list);
  });
  return list;
}

/** Native select semantics and the original event handler stay intact. Aliases
 * resolve to a supported canonical value before any business request is made. */
export const AdminSelect = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { dropdownKey: string }>(function AdminSelect({ dropdownKey, children, onChange, value, ...props }, ref) {
  const context = useContext(Context);
  const snapshot = collect(children);
  const signature = JSON.stringify(snapshot.map(item => item.option));
  const latest = useRef(snapshot);
  latest.current = snapshot;
  useEffect(() => { context?.remember(dropdownKey, latest.current.map(item => item.option)); }, [context?.remember, dropdownKey, signature]);
  const config = context?.configs[dropdownKey];
  const base = new Map(snapshot.map(item => [item.option.value, item]));
  const selected = value === undefined ? undefined : String(value);
  const [chosen, setChosen] = useState<string>();
  const entries = config?.entries.filter(entry => base.has(entry.mapsTo)) || [];
  const configured = new Set(entries.map(entry => entry.value));
  const options = [...entries, ...snapshot.filter(item => !configured.has(item.option.value)).map(item => ({ ...item.option, mapsTo: item.option.value, hidden: false, deleted: false }))]
    .filter(entry => !entry.deleted && (!entry.hidden || entry.mapsTo === selected));
  // A previously saved or externally assigned value must remain visible even if
  // an administrator hid it or the underlying API currently omits that record.
  if (selected !== undefined && !options.some(entry => entry.mapsTo === selected)) options.push({ value: selected, mapsTo: selected, label: base.get(selected)?.option.label || selected || 'Choose…', hidden: false, deleted: false });
  const active = options.find(entry => entry.value === chosen && entry.mapsTo === selected) || options.find(entry => entry.mapsTo === selected);
  if (!config || !snapshot.length || props.multiple) return <select {...props} value={value} onChange={onChange} ref={ref}>{children}</select>;
  return <select {...props} ref={ref} value={selected === undefined ? undefined : active?.value ?? value} onChange={event => {
    const option = options.find(entry => entry.value === event.currentTarget.value);
    setChosen(option?.value);
    if (!option) { onChange?.(event); return; }
    const target = new Proxy(event.currentTarget, { get(node, key) { const value = key === 'value' ? option.mapsTo : Reflect.get(node, key, node); return typeof value === 'function' ? value.bind(node) : value; } });
    onChange?.({ ...event, target, currentTarget: target });
  }}>{options.map(entry => <option {...base.get(entry.mapsTo)?.element.props} key={entry.value} value={entry.value}>{entry.label}</option>)}</select>;
});
