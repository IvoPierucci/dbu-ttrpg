import { actorAt, MAX_VEHICLE_LEVEL, VEHICLE_SIZES, vehicleReading } from "../vehicles.mjs";

const fields = foundry.data.fields;

/**
 * A Vehicle (the Vehicles page; the user's, 2026-11-15): an Actor type of its own, nothing of a Character's in it. What it was made
 * with is kept - Craftsmanship Grade, Size Category, Vehicle Level, Vehicle Qualities, Pilot Seat, Creator - and its Life, Ki and
 * Capacity spent; everything else is worked out from those (vehicles.mjs vehicleReading).
 *
 * The derived values carry the names a Character's do - life.max, soakValue, damageReduction, defenseValue, size.steps,
 * tierOfPower - so what reads a target of an attack reads a Vehicle the same way.
 */
export default class DBUVehicleData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const int = (initial, min = 0, max) => new fields.NumberField({ required: true, integer: true, nullable: false, initial, min,
      ...(max !== undefined ? { max } : {}) });
    return {
      grade: int(1, 1, 5),
      size: new fields.StringField({ required: true, initial: VEHICLE_SIZES[0], choices: [...VEHICLE_SIZES] }),
      vehicleLevel: int(1, 1, MAX_VEHICLE_LEVEL),
      life: new fields.SchemaField({ value: int(50) }),
      ki: new fields.SchemaField({ value: int(30) }),
      capacity: new fields.SchemaField({ spent: int(0) }),
      // Each Vehicle Quality: its file's id, the Quality Slots it takes (a range's choice), and the Battle Environments it chose.
      qualities: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false }),
        slots: int(1, 1),
        choices: new fields.ArrayField(new fields.StringField({ required: true, blank: true }))
      })),
      // "If your Vehicle's Size Category is Enormous or larger, you must select a Square within that Vehicle" - its place among
      // the Squares, row by row from the front left.
      pilotSeat: int(0),
      // Adjustable: the Battle Environment Favored Environment is set to now - its own, or one of Adjustable's two. Blank, its own.
      activeEnvironment: new fields.StringField({ required: true, blank: true, initial: "" }),
      // Who made it - an Actor's uuid - for the Prerequisites that ask about its Creator's Skill Ranks.
      creator: new fields.StringField({ required: true, blank: true, initial: "" }),
      // Who is in it: one Pilot and its Passengers, by uuid (the Ride Maneuver's).
      crew: new fields.SchemaField({
        pilot: new fields.StringField({ required: true, blank: true, initial: "" }),
        passengers: new fields.ArrayField(new fields.StringField({ required: true, blank: false }))
      }),
      description: new fields.HTMLField({ required: true, blank: true, initial: "" })
    };
  }

  prepareDerivedData() {
    const reading = vehicleReading(this, { creator: actorAt(this.creator) });
    this.reading = reading;
    this.output = reading.output;
    this.powerLevel = reading.level;
    this.tierOfPower = reading.tier;
    this.baseTierOfPower = reading.tier;
    this.life.max = reading.lifeMax;
    this.ki.max = reading.kiMax;
    this.capacity.max = reading.capacity.max;
    this.capacity.remaining = reading.capacity.left;
    this.defenseValue = reading.defenseValue;
    this.soakValue = reading.soakValue;
    this.damageReduction = reading.damageReduction;
    this.might = reading.might;
    this.speed = { ...reading.speed };
    this.hardnessRank = reading.hardnessRank;
    this.hardness = reading.hardness;
    this.sizeKey = reading.size.key;
    this.squares = { cols: reading.size.cols, rows: reading.size.rows };
    // A Vehicle is no Character: no effects, no Combat Conditions ("A Vehicle cannot obtain Combat Conditions"), never Defeated -
    // destroyed at 0 Life Points. Empty, so what reads a target's finds nothing rather than failing.
    this.effects = { slots: {}, parts: {}, programs: [] };
    this.conditions = {};
    this.defeated = false;
    // What an attack's working reads off any target, and a Vehicle has none of (its Pilot rolls its Dodge): nothing, so it reads
    // nothing rather than failing. No Health Thresholds - "healthy" whatever its Life Points.
    this.dice = { extra: { formula: "" }, critical: { formula: "" } };
    this.rollModifiers = {};
    this.diminishing = { defense: { penalty: 0, perAttack: 0 }, offense: { penalty: 0, perAttack: 0 } };
    this.diminishingDefense = 0;
    this.threshold = { key: "healthy", penalty: 0 };
    this.actions = { counter: 0, counterLeft: 0, standard: 0 };
    this.states = {};
    this.battlefield = {};
    this.resources = {};
    this.minion = false;
    this.destroyed = (Number(this.life.value) || 0) <= 0;
  }
}
