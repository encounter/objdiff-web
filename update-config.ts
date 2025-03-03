import { readFileSync, writeFileSync } from 'node:fs';
import { CONFIG_SCHEMA } from './shared/config';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
const extensionConfig = packageJson.contributes.configuration.find(
  (config: any) => config.title === 'Extension',
);
const categories: any[] = [];
if (extensionConfig) {
  categories.push(extensionConfig);
}
for (const group of CONFIG_SCHEMA.groups) {
  const category: any = {
    title: group.name,
    properties: {},
  };
  for (const id of group.properties) {
    const property = CONFIG_SCHEMA.properties.find((p) => p.id === id);
    if (!property) {
      continue;
    }
    const config: any = {
      type: property.type === 'boolean' ? 'boolean' : 'string',
      description: property.description,
      default: property.default,
    };
    if (property.type === 'choice') {
      config.enum = property.items.map((item) => item.value);
      config.enumItemLabels = property.items.map((item) => item.name);
      config.enumDescriptions = property.items.map((item) => item.description);
    }
    category.properties[`objdiff.${property.id}`] = config;
  }
  categories.push(category);
}
packageJson.contributes.configuration = categories;
writeFileSync('./package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
