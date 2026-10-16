import { describe, expect, it } from 'vitest';
import { matchPlace, nameScore, normalize, parseCommand, type Command, type Place } from '../src/commands/CommandParser';

const place = (id: string, names: string[], kind: Place['kind'] = 'destination'): Place => ({ id, label: names[0], names, x: 0, z: 0, kind });

const PLACES: Place[] = [
  place('csmt', ['Chhatrapati Shivaji Maharaj Terminus', 'छत्रपती शिवाजी महाराज टर्मिनस', 'victoria terminus', 'vt', 'cst', 'विक्टोरिया टर्मिनस', 'व्हिक्टोरिया टर्मिनस', 'सीएसटी']),
  place('haji-ali', ['Haji Ali', 'हाजी अली', 'haji ali dargah']),
  place('gateway', ['Gateway of India', 'गेटवे ऑफ इंडिया', 'taj']),
  place('siddhivinayak', ['Siddhivinayak Temple', 'सिद्धिविनायक मंदिर', 'prabhadevi']),
  place('bandra-station', ['Bandra Station', 'वांद्रे स्टेशन', 'bandra']),
  place('marine-drive', ['Marine Drive', 'मरीन ड्राइव्ह', "queen's necklace"]),
  place('poi:1', ['Bombay Hospital'], 'poi'),
  place('road:1', ['Gopalrao Deshmukh Marg', 'pedder road'], 'road'),
];

const run = (text: string): Command | null => parseCommand(text, PLACES);
const gotoId = (text: string) => {
  const c = run(text);
  return c?.type === 'goto' ? { id: c.place.id, drive: c.drive } : c;
};

describe('command parser — going places', () => {
  it('drives to Victoria Terminus on "Go to Victoria Terminus"', () => {
    expect(gotoId('Go to Victoria Terminus')).toEqual({ id: 'csmt', drive: true });
  });

  it('understands nicknames, typos and polite filler', () => {
    expect(gotoId('take me to VT')).toEqual({ id: 'csmt', drive: true });
    expect(gotoId('please go to victoria terminal')).toEqual({ id: 'csmt', drive: true });
    expect(gotoId('drive me to sidhivinayak')).toEqual({ id: 'siddhivinayak', drive: true });
    expect(gotoId('go to the taj')).toEqual({ id: 'gateway', drive: true });
    expect(gotoId('go to pedder road')).toEqual({ id: 'road:1', drive: true });
  });

  it('only sets a route for navigate / directions', () => {
    expect(gotoId('Navigate to Haji Ali')).toEqual({ id: 'haji-ali', drive: false });
    expect(gotoId('show me the way to Marine Drive')).toEqual({ id: 'marine-drive', drive: false });
  });

  it('accepts Hinglish, Hindi and Marathi phrasing', () => {
    expect(gotoId('Bandra le chalo')).toEqual({ id: 'bandra-station', drive: true });
    expect(gotoId('haji ali chalo bhai')).toEqual({ id: 'haji-ali', drive: true });
    expect(gotoId('सीएसटी चलो')).toEqual({ id: 'csmt', drive: true });
    expect(gotoId('विक्टोरिया टर्मिनस ले चलो')).toEqual({ id: 'csmt', drive: true });
    // Marathi case suffix glued to the name: "…टर्मिनसला चला".
    expect(gotoId('व्हिक्टोरिया टर्मिनसला चला')).toEqual({ id: 'csmt', drive: true });
    expect(gotoId('हाजी अलीला घेऊन चला')).toEqual({ id: 'haji-ali', drive: true });
  });

  it('reports places it cannot find instead of guessing', () => {
    expect(run('go to xyzzy plaza')).toEqual({ type: 'unknownPlace', query: 'xyzzy plaza', drive: true });
  });

  it('treats a bare landmark name as a request to go there', () => {
    expect(gotoId('Haji Ali')).toEqual({ id: 'haji-ali', drive: true });
  });
});

describe('command parser — vehicles, traffic and the city', () => {
  it('spawns rickshaws and other traffic with counts', () => {
    expect(run('add a rickshaw')).toEqual({ type: 'spawn', kind: 'auto', count: 1 });
    expect(run('add 5 rickshaws')).toEqual({ type: 'spawn', kind: 'auto', count: 5 });
    expect(run('spawn three taxis')).toEqual({ type: 'spawn', kind: 'taxi', count: 3 });
    expect(run('ऑटो लाओ')).toEqual({ type: 'spawn', kind: 'auto', count: 1 });
    expect(run('दो बस लाओ')).toEqual({ type: 'spawn', kind: 'bus1', count: 2 });
    expect(run('more buses')).toMatchObject({ type: 'spawn', kind: 'bus1' });
  });

  it('switches the vehicle you drive', () => {
    expect(run('drive the bus')).toEqual({ type: 'vehicle', id: 'bus' });
    expect(run('switch to rickshaw')).toEqual({ type: 'vehicle', id: 'auto' });
    expect(run('I want to drive the taxi')).toEqual({ type: 'vehicle', id: 'taxi' });
    expect(run('रिक्षा चालवा')).toEqual({ type: 'vehicle', id: 'auto' });
  });

  it('does not confuse "drive to X" with switching vehicle', () => {
    expect(gotoId('drive to bandra')).toEqual({ id: 'bandra-station', drive: true });
  });

  it('makes the city busier or calmer', () => {
    expect(run('make it busier')).toEqual({ type: 'busier' });
    expect(run('make it more crowded like bombay')).toEqual({ type: 'busier' });
    expect(run('more traffic')).toEqual({ type: 'traffic', level: 'up' });
    expect(run('no traffic')).toEqual({ type: 'traffic', level: 0 });
    expect(run('traffic 3')).toEqual({ type: 'traffic', level: 3 });
    expect(run('less people')).toEqual({ type: 'crowd', level: 'down' });
  });

  it('changes time of day and weather', () => {
    expect(run('make it night')).toEqual({ type: 'time', value: 'night' });
    expect(run('रात')).toEqual({ type: 'time', value: 'night' });
    expect(run('sunset')).toEqual({ type: 'time', value: 'sunset' });
    expect(run('rain')).toEqual({ type: 'weather', value: 'monsoon' });
    expect(run('पाऊस')).toEqual({ type: 'weather', value: 'monsoon' });
    expect(run('stop the rain')).toEqual({ type: 'weather', value: 'clear' });
  });

  it('handles control commands', () => {
    expect(run('stop')).toEqual({ type: 'stop' });
    expect(run('थांबा')).toEqual({ type: 'stop' });
    expect(run('रुको')).toEqual({ type: 'stop' });
    expect(run('honk')).toEqual({ type: 'horn' });
    expect(run('lights off')).toEqual({ type: 'lights', on: false });
    expect(run('cockpit view')).toEqual({ type: 'camera', mode: 'cockpit' });
    expect(run('where am I')).toEqual({ type: 'whereami' });
    expect(run('help')).toEqual({ type: 'help' });
    expect(run('cancel route')).toEqual({ type: 'cancelRoute' });
  });

  it('returns null for gibberish', () => {
    expect(run('qwertyuiop')).toBeNull();
    expect(run('   ')).toBeNull();
  });
});

describe('place matching', () => {
  it('normalises case, punctuation and the Devanagari nukta', () => {
    expect(normalize("  Queen's  NECKLACE! ")).toBe('queens necklace');
    expect(normalize('ज़्यादा')).toBe(normalize('ज्यादा'));
  });

  it('scores exact names highest and rejects unrelated ones', () => {
    expect(nameScore('haji ali', 'Haji Ali')).toBe(1);
    expect(nameScore('victoria terminal', 'victoria terminus')).toBeGreaterThan(0.8);
    expect(nameScore('bandra', 'Haji Ali')).toBe(0);
  });

  it('prefers curated destinations over roads and POIs with similar names', () => {
    const list = [place('road:x', ['Haji Ali Road'], 'road'), place('haji-ali', ['Haji Ali'])];
    expect(matchPlace('haji ali', list)?.place.id).toBe('haji-ali');
  });
});
