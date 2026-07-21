// Test entry: importing each suite registers its cases, then report() runs them.
import "./subitems.test";
import "./directives.test";
import "./directives-golden.test";
import "./agenda.test";
import "./streak.test";
import "./layout.test";
import { report } from "./_harness";

report();
