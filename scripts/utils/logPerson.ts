/**
 * CLI utility for logging person information with color formatting
 */

import chalk from 'chalk';
import fs from 'fs';
import type { Person } from '@fsf/shared';

interface LogPersonOptions {
  person: Person & { id?: string };
  icon?: string;
  generation?: number | string;
  bio?: boolean;
  logToTSV?: boolean;
  selfID?: string;
}

export const logPerson = ({
  person,
  icon,
  generation,
  bio,
  logToTSV,
  selfID,
}: LogPersonOptions): void => {
  const gen = generation;
  const cGen =
    gen != null && gen !== '?'
      ? `${chalk.hex('#EEEEEE').inverse(`${gen}`.padStart(3, '0'))} `
      : '';
  const id = person.id;
  const cID = chalk.blue(person.id);
  const parents = `${person.parents[0] || '?'}+${person.parents[1] || '?'}`;
  const cParents = `(${parents})`.padEnd(19, ' ');
  const lifespan = person.lifespan;
  const cLifespan = chalk
    .hex('#EEEEEE')
    .inverse(lifespan.padStart(18, ' ').padEnd(20, ' '));
  const name = person.name;
  const cName = chalk.hex('#DEADED').bold(person.name);
  const instances = person.children.length;
  const cInstances =
    person.children.length > 1
      ? ` ${chalk.hex('#d6406e').bold(`(x${person.children.length})`)}`
      : ``;
  const location = person.location || '';
  const cLocation = person.location ? `, ${person.location}` : '';
  const occupation = person.occupation || '';
  const cOccupation = person.occupation
    ? chalk.blue(`, ${person.occupation}`)
    : '';

  const logString = `${
    icon ? `${icon} ` : ``
  }${cGen}${cID} ${cParents} ${cLifespan} ${cName}${cInstances}${cLocation}${cOccupation}${
    bio ? ` - ${person.bio}` : ''
  }`;
  console.log(logString);
  if (logToTSV && selfID) {
    fs.appendFileSync(
      `./data/${selfID}.tsv`,
      `${gen}\t${id}\t${parents}\t${lifespan}\t${name}\t${instances}\t${location}\t${occupation}\t${
        person.bio || ''
      }\n`
    );
  }
};

export default logPerson;
