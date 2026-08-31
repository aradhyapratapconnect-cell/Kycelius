"use strict";
// Autonomous Mode risk-tolerance policy (F-11), per Security & Access
// Document §4: a confirm_required tool skips confirmation only when BOTH
// (1) the master Autonomous Mode toggle is on, and
// (2) THIS specific tool is marked "auto" ("Always Allow") in tool_overrides.
// "never" blocks before anything else can help — nothing overrides it.
//
// The config is read live on every check — never cached — so a user changing
// an override mid-plan applies to the next step's permission check and can't
// retroactively affect steps already past theirs.
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureAutonomousPolicy = configureAutonomousPolicy;
exports.configureAutonomousOverrideWriter = configureAutonomousOverrideWriter;
exports.getAutonomousOverride = getAutonomousOverride;
exports.writeAutonomousOverride = writeAutonomousOverride;
exports.isAutoApprovedUnderAutonomousMode = isAutoApprovedUnderAutonomousMode;
const db_1 = require("../db/db");
let source = () => db_1.autonomousModeConfig.get();
/** Tests inject a fake config source; production reads the DB live. */
function configureAutonomousPolicy(next) {
    source = next;
}
let writer = (toolName, tier) => {
    const config = db_1.autonomousModeConfig.get();
    db_1.autonomousModeConfig.set({
        tool_overrides: { ...config.tool_overrides, [toolName]: tier },
    });
};
/** Tests inject a fake writer; production writes the shared store (T-21). */
function configureAutonomousOverrideWriter(next) {
    writer = next;
}
/** The user's current tier for a tool, or undefined when untouched. */
function getAutonomousOverride(toolName) {
    return source().tool_overrides?.[toolName];
}
/** Persist one action's tier to the single shared permission store. */
function writeAutonomousOverride(toolName, tier) {
    writer(toolName, tier);
}
function isAutoApprovedUnderAutonomousMode(toolName) {
    const config = source();
    if (!config || config.enabled !== true)
        return false;
    return config.tool_overrides?.[toolName] === 'auto';
}
