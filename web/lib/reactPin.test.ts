import { describe, expect, it } from 'vitest';
import root from '../../package.json';
import web from '../package.json';

// The root package.json `overrides` pins one React for the whole workspace tree (without it the
// lockfile kept React 18 hoisted next to web's 19, bundling two Reacts). An override wins over
// web's own dependency, so bumping React in web/package.json alone would silently do nothing:
// this fails until both move together.
describe('React version pin', () => {
  it('root overrides match web’s react and react-dom', () => {
    const overrides = (root as { overrides?: Record<string, string> }).overrides ?? {};
    expect(overrides.react).toBe(web.dependencies.react);
    expect(overrides['react-dom']).toBe(web.dependencies['react-dom']);
    expect(web.dependencies.react).toBe(web.dependencies['react-dom']);
  });

  it('React types track the runtime minor', () => {
    const minor = (v: string) => v.replace(/^[~^]/, '').split('.').slice(0, 2).join('.');
    expect(minor(web.devDependencies['@types/react'])).toBe(minor(web.dependencies.react));
    expect(minor(web.devDependencies['@types/react-dom'])).toBe(minor(web.dependencies['react-dom']));
  });
});
