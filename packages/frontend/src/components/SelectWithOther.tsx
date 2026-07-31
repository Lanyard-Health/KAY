import { useEffect, useState } from 'react';
import { OTHER_OPTION } from '../constants/practiceOptions';

interface SelectWithOtherProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: readonly string[];
  groups?: { label: string; options: string[] }[];
  placeholder?: string;
  id?: string;
}

/**
 * A <select> whose final entry is "Other (type it in)". Picking Other reveals a
 * free-text input. If the bound value isn't one of the listed options (e.g. an
 * existing record with a custom vendor), the component opens in Other mode with
 * that value prefilled. Controlled via value/onChange so it works in both
 * react-hook-form (Controller) and plain useState forms.
 */
export default function SelectWithOther({
  label,
  value,
  onChange,
  options,
  groups,
  placeholder = 'Select...',
  id,
}: SelectWithOtherProps) {
  const flat = options ? [...options] : groups ? groups.flatMap((g) => g.options) : [];
  const valueIsKnown = value !== '' && flat.includes(value);
  const [isOther, setIsOther] = useState(value !== '' && !valueIsKnown);

  useEffect(() => {
    if (value !== '') setIsOther(!flat.includes(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const selectValue = isOther ? OTHER_OPTION : valueIsKnown ? value : '';

  return (
    <div>
      <label className="label">{label}</label>
      <select
        id={id}
        className="input"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER_OPTION) {
            setIsOther(true);
            onChange('');
          } else {
            setIsOther(false);
            onChange(v);
          }
        }}
      >
        <option value="">{placeholder}</option>
        {options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={OTHER_OPTION}>{OTHER_OPTION} (type it in)</option>
      </select>
      {isOther && (
        <input
          className="input mt-2"
          placeholder="Type it in"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
