type Layer = { target: object; parent?: object; forwarded: Set<PropertyKey> };
const layers = new WeakMap<object, Layer>();
const noForwarding = new Set<PropertyKey>();
const own = Object.hasOwn;
const descriptor = Object.getOwnPropertyDescriptor;

export const contextTarget = (context: object): object =>
  layers.get(context)?.target ?? context;

function* contextLayers(context?: object): Generator<Layer> {
  let current: object | undefined = context;
  while (current) {
    const layer = layers.get(current);
    yield layer ?? { target: current, forwarded: noForwarding };
    current = layer?.parent;
  }
}

const ownTarget = (
  context: object | undefined,
  key: PropertyKey
): object | undefined => {
  const mirrors: Layer[] = [];
  for (const layer of contextLayers(context)) {
    const { target, forwarded } = layer;
    if (own(target, key) && !forwarded.has(key)) return target;
    if (forwarded.has(key)) mirrors.push(layer);
    if (!Object.isExtensible(target) && !own(target, key)) break;
  }
  for (const { target, forwarded } of mirrors)
    if (Reflect.deleteProperty(target, key)) forwarded.delete(key);
  return undefined;
};

const prototypeTarget = (
  context: object,
  key: PropertyKey
): object | undefined => {
  for (const { target } of contextLayers(context)) {
    const prototype = Object.getPrototypeOf(target);
    if (prototype && key in prototype) return prototype;
  }
  return undefined;
};

const contextKeys = (context: object): (string | symbol)[] => {
  const groups: (string | symbol)[][] = [];
  for (const { target, parent, forwarded } of contextLayers(context)) {
    for (const key of forwarded) {
      if (!ownTarget(parent, key) && Reflect.deleteProperty(target, key))
        forwarded.delete(key);
    }
    groups.push(Reflect.ownKeys(target));
    if (!Object.isExtensible(target)) break;
  }
  return [...new Set(groups.reverse().flat())];
};

// Bindings keep their owners; the target also mirrors the shape of closed views.
export const createContext = (parent?: object): object => {
  const target = Object.create(null);
  if (!parent) return target;
  const forwarded = new Set<PropertyKey>();
  const context: object = new Proxy(target, {
    get: (_, key, receiver) => {
      const owner = ownTarget(context, key) ?? prototypeTarget(context, key);
      return owner && Reflect.get(owner, key, receiver);
    },
    set: (_, key, value, receiver) => {
      const owner = key === 'Module' ? target : ownTarget(context, key);
      const source = owner ?? prototypeTarget(context, key) ?? target;
      let property: PropertyDescriptor | undefined;
      for (
        let current = source;
        current && !property;
        current = Object.getPrototypeOf(current)
      )
        property = descriptor(current, key);
      return Reflect.set(
        source,
        key,
        value,
        receiver !== context || (property && !('value' in property))
          ? receiver
          : owner ?? target
      );
    },
    has: (_, key) =>
      !!(ownTarget(context, key) ?? prototypeTarget(context, key)),
    ownKeys: () => contextKeys(context),
    getOwnPropertyDescriptor: (_, key) => {
      const owner = ownTarget(context, key);
      const property = owner && descriptor(owner, key);
      if (owner === target || !property) return property;
      const visible = {
        ...property,
        configurable: descriptor(target, key)?.configurable ?? true,
      };
      if (forwarded.has(key)) Reflect.defineProperty(target, key, visible);
      return visible;
    },
    defineProperty: (_, key, property) => {
      const owner = ownTarget(context, key) ?? target;
      if (!Reflect.defineProperty(owner, key, property)) return false;
      if (
        owner !== target &&
        (own(target, key) || property.configurable === false)
      ) {
        const updated = descriptor(owner, key);
        if (!updated) return false;
        const configurable =
          property.configurable ??
          descriptor(target, key)?.configurable ??
          true;
        if (!Reflect.defineProperty(target, key, { ...updated, configurable }))
          return false;
        forwarded.add(key);
      }
      return true;
    },
    deleteProperty: (_, key) => {
      const owner = ownTarget(context, key);
      if (owner && !Reflect.deleteProperty(owner, key)) return false;
      if (forwarded.has(key)) {
        if (!Reflect.deleteProperty(target, key)) return false;
        forwarded.delete(key);
      }
      return true;
    },
    preventExtensions: () => {
      for (const key of contextKeys(context)) {
        if (own(target, key)) continue;
        const owner = ownTarget(context, key);
        const property = owner && descriptor(owner, key);
        if (!property) continue;
        Reflect.defineProperty(target, key, {
          ...property,
          configurable: true,
        });
        forwarded.add(key);
      }
      return Reflect.preventExtensions(target);
    },
  });
  layers.set(context, { target, parent, forwarded });
  return context;
};
