import headerStyles from '../common/Header.module.css';
import styles from './SettingsView.module.css';

import { version as wasmVersion } from 'objdiff-wasm';
import {
  CONFIG_SCHEMA,
  type ConfigPropertyBoolean,
  type ConfigPropertyChoice,
} from '../../shared/config';
import {
  inVsCode,
  openSettings,
  setConfigProperty,
  useAppStore,
  useExtensionStore,
} from '../state';

const BooleanProperty = ({
  property,
  value,
}: { property: ConfigPropertyBoolean; value: boolean }) => (
  <div className={styles.property} title={property.description}>
    <input
      type="checkbox"
      id={property.id}
      checked={value}
      onChange={(e) => {
        const value = e.target.checked;
        if (value === property.default) {
          setConfigProperty(property.id, undefined);
        } else {
          setConfigProperty(property.id, value);
        }
      }}
    />
    <label htmlFor={property.id}>{property.name}</label>
  </div>
);

const ChoiceProperty = ({
  property,
  value,
}: { property: ConfigPropertyChoice; value: string }) => (
  <div className={styles.property} title={property.description}>
    <label htmlFor={property.id}>{property.name}</label>
    <select
      id={property.id}
      defaultValue={value}
      onChange={(e) => {
        const value = e.target.value;
        if (value === property.default) {
          setConfigProperty(property.id, undefined);
        } else {
          setConfigProperty(property.id, value);
        }
      }}
    >
      {property.items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.name}
        </option>
      ))}
    </select>
  </div>
);

const SettingsView = () => {
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const configProperties = useExtensionStore((state) => state.configProperties);

  const items = [];
  for (const group of CONFIG_SCHEMA.groups) {
    items.push(
      <h2 className={styles.categoryHeader} key={group.id}>
        {group.name}
      </h2>,
    );
    for (const id of group.properties) {
      const property = CONFIG_SCHEMA.properties.find((p) => p.id === id);
      if (!property) {
        continue;
      }
      const value = configProperties[property.id] ?? property.default;
      switch (property.type) {
        case 'boolean':
          items.push(
            <BooleanProperty
              key={property.id}
              property={property}
              value={value as boolean}
            />,
          );
          break;
        case 'choice':
          items.push(
            <ChoiceProperty
              key={property.id}
              property={property}
              value={value as string}
            />,
          );
          break;
      }
    }
  }

  return (
    <>
      <div className={headerStyles.header}>
        <button title="Back" onClick={() => setCurrentView('main')}>
          <span className="codicon codicon-chevron-left" />
        </button>
        {inVsCode && (
          <button onClick={() => openSettings()}>Open in Editor</button>
        )}
      </div>
      <div className={styles.container}>
        <h1 className={styles.header}>About</h1>
        {window.webviewProps?.extensionVersion && (
          <p>
            <strong>Extension version:</strong>{' '}
            {window.webviewProps.extensionVersion}
          </p>
        )}
        <p>
          <strong>objdiff version:</strong> {wasmVersion()}
        </p>
        <h1 className={styles.header}>Settings</h1>
        {items}
      </div>
    </>
  );
};

export default SettingsView;
