// Test entry: importing each suite registers its cases, then report() runs them.
import "./subitems.test";
import "./directives.test";
import "./directives-golden.test";
import "./localevents.test";
import "./agenda.test";
import "./streak.test";
import "./layout.test";
import "./layoutstore.test";
import "./aicreds.test";
import "./jsonlist.test";
import { report } from "./_harness";

report();
