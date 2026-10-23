import type { IDatabase } from "./IDatabase";

export interface DatabaseMigration {
  readonly version: number;
  readonly description: string;
  readonly sql: string;
}

/**
 * Local schema v1 from PRD_Game_Designv4 "Database & Data Schema".
 * Additional domain tables are introduced through later versioned migrations.
 */
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    description: "career, divisions, teams, drivers, cars, circuits, races, finances",
    sql: `
      CREATE TABLE career (
        career_id TEXT PRIMARY KEY,
        user_id TEXT,
        career_name TEXT NOT NULL,
        current_division_tier INTEGER NOT NULL CHECK (current_division_tier BETWEEN 1 AND 6),
        highest_unlocked_tier INTEGER NOT NULL CHECK (highest_unlocked_tier BETWEEN 1 AND 6),
        sandbox_rules TEXT,
        current_season INTEGER NOT NULL DEFAULT 1 CHECK (current_season >= 1),
        current_race INTEGER NOT NULL DEFAULT 1 CHECK (current_race >= 1),
        game_mode TEXT NOT NULL CHECK (game_mode IN ('career', 'sandbox', 'quick_season')),
        difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard')),
        world_seed TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE divisions (
        division_id TEXT PRIMARY KEY,
        tier INTEGER NOT NULL UNIQUE CHECK (tier BETWEEN 1 AND 6),
        name TEXT NOT NULL,
        rounds_per_season INTEGER NOT NULL CHECK (rounds_per_season > 0),
        distance_factor REAL NOT NULL CHECK (distance_factor > 0 AND distance_factor <= 1),
        min_driver_age INTEGER NOT NULL CHECK (min_driver_age >= 0),
        max_driver_age INTEGER NOT NULL CHECK (max_driver_age >= min_driver_age),
        required_budget INTEGER NOT NULL CHECK (required_budget > 0),
        is_playable INTEGER NOT NULL CHECK (is_playable IN (0, 1)),
        is_visible INTEGER NOT NULL CHECK (is_visible IN (0, 1))
      );

      CREATE TABLE teams (
        team_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        division_id TEXT NOT NULL REFERENCES divisions(division_id),
        pool_team_id TEXT,
        name TEXT NOT NULL,
        is_player_team INTEGER NOT NULL DEFAULT 0 CHECK (is_player_team IN (0, 1)),
        base_country TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        origin TEXT NOT NULL CHECK (origin IN ('pool', 'generated')),
        founded_season INTEGER NOT NULL CHECK (founded_season >= 1),
        affordability REAL NOT NULL DEFAULT 1,
        distress_seasons INTEGER NOT NULL DEFAULT 0 CHECK (distress_seasons >= 0),
        movement_cooldown INTEGER NOT NULL DEFAULT 0 CHECK (movement_cooldown >= 0),
        strength_grade TEXT NOT NULL CHECK (strength_grade IN ('A', 'B', 'C', 'D')),
        finance_grade TEXT NOT NULL CHECK (finance_grade IN ('A', 'B', 'C', 'D')),
        performance_grade TEXT NOT NULL CHECK (performance_grade IN ('A', 'B', 'C', 'D')),
        personality TEXT NOT NULL,
        reputation INTEGER NOT NULL DEFAULT 0 CHECK (reputation BETWEEN 0 AND 9999),
        cash INTEGER NOT NULL,
        debt INTEGER NOT NULL DEFAULT 0 CHECK (debt >= 0),
        budget INTEGER NOT NULL CHECK (budget >= 0),
        aero_center_level INTEGER NOT NULL DEFAULT 1 CHECK (aero_center_level BETWEEN 1 AND 10),
        engine_dept_level INTEGER NOT NULL DEFAULT 1 CHECK (engine_dept_level BETWEEN 1 AND 10),
        chassis_level INTEGER NOT NULL DEFAULT 1 CHECK (chassis_level BETWEEN 1 AND 10),
        simulator_level INTEGER NOT NULL DEFAULT 1 CHECK (simulator_level BETWEEN 1 AND 10),
        rnd_level INTEGER NOT NULL DEFAULT 1 CHECK (rnd_level BETWEEN 1 AND 10),
        academy_level INTEGER NOT NULL DEFAULT 1 CHECK (academy_level BETWEEN 1 AND 10),
        reliability REAL NOT NULL DEFAULT 0 CHECK (reliability BETWEEN 0 AND 100),
        UNIQUE (career_id, name)
      );

      CREATE TABLE drivers (
        driver_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        pace REAL NOT NULL CHECK (pace BETWEEN 0 AND 100),
        qualifying REAL NOT NULL CHECK (qualifying BETWEEN 0 AND 100),
        racecraft REAL NOT NULL CHECK (racecraft BETWEEN 0 AND 100),
        consistency REAL NOT NULL CHECK (consistency BETWEEN 0 AND 100),
        wet_skill REAL NOT NULL CHECK (wet_skill BETWEEN 0 AND 100),
        tyre_management REAL NOT NULL CHECK (tyre_management BETWEEN 0 AND 100),
        overtaking REAL NOT NULL CHECK (overtaking BETWEEN 0 AND 100),
        defending REAL NOT NULL CHECK (defending BETWEEN 0 AND 100),
        starts REAL NOT NULL CHECK (starts BETWEEN 0 AND 100),
        adaptability REAL NOT NULL CHECK (adaptability BETWEEN 0 AND 100),
        focus REAL NOT NULL CHECK (focus BETWEEN 0 AND 100),
        pressure REAL NOT NULL CHECK (pressure BETWEEN 0 AND 100),
        morale REAL NOT NULL CHECK (morale BETWEEN 0 AND 100),
        confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 100),
        aggression REAL NOT NULL CHECK (aggression BETWEEN 0 AND 100),
        teamwork REAL NOT NULL CHECK (teamwork BETWEEN 0 AND 100),
        potential REAL NOT NULL CHECK (potential BETWEEN 0 AND 100),
        development_rate REAL NOT NULL CHECK (development_rate >= 0),
        injury_resistance REAL NOT NULL CHECK (injury_resistance BETWEEN 0 AND 100),
        loyalty REAL NOT NULL CHECK (loyalty BETWEEN 0 AND 100),
        ambition REAL NOT NULL CHECK (ambition BETWEEN 0 AND 100),
        fan_popularity REAL NOT NULL CHECK (fan_popularity BETWEEN 0 AND 100),
        age INTEGER NOT NULL CHECK (age >= 0),
        nationality TEXT NOT NULL,
        name_culture TEXT NOT NULL,
        avatar_id TEXT,
        is_retired INTEGER NOT NULL DEFAULT 0 CHECK (is_retired IN (0, 1)),
        retire_reason TEXT CHECK (retire_reason IN ('age', 'no_team', 'fatal')),
        reputation INTEGER NOT NULL DEFAULT 0 CHECK (reputation BETWEEN 0 AND 9999),
        market_value INTEGER NOT NULL DEFAULT 0 CHECK (market_value >= 0),
        is_academy_driver INTEGER NOT NULL DEFAULT 0 CHECK (is_academy_driver IN (0, 1)),
        loaned_to_team_id TEXT REFERENCES teams(team_id),
        UNIQUE (career_id, name)
      );

      CREATE TABLE driver_contracts (
        contract_id TEXT PRIMARY KEY,
        driver_id TEXT NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        start_season INTEGER NOT NULL CHECK (start_season >= 1),
        end_season INTEGER NOT NULL CHECK (end_season >= start_season),
        salary INTEGER NOT NULL CHECK (salary >= 0),
        signing_bonus INTEGER NOT NULL DEFAULT 0 CHECK (signing_bonus >= 0),
        win_bonus INTEGER NOT NULL DEFAULT 0 CHECK (win_bonus >= 0),
        podium_bonus INTEGER NOT NULL DEFAULT 0 CHECK (podium_bonus >= 0),
        championship_bonus INTEGER NOT NULL DEFAULT 0 CHECK (championship_bonus >= 0),
        release_clause INTEGER CHECK (release_clause IS NULL OR release_clause >= 0),
        team_option INTEGER NOT NULL DEFAULT 0 CHECK (team_option IN (0, 1)),
        driver_option INTEGER NOT NULL DEFAULT 0 CHECK (driver_option IN (0, 1))
      );

      CREATE TABLE cars (
        car_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season >= 1),
        engine_power REAL NOT NULL CHECK (engine_power BETWEEN 0 AND 100),
        aero REAL NOT NULL CHECK (aero BETWEEN 0 AND 100),
        high_speed REAL NOT NULL CHECK (high_speed BETWEEN 0 AND 100),
        medium_speed REAL NOT NULL CHECK (medium_speed BETWEEN 0 AND 100),
        low_speed REAL NOT NULL CHECK (low_speed BETWEEN 0 AND 100),
        mechanical_grip REAL NOT NULL CHECK (mechanical_grip BETWEEN 0 AND 100),
        traction REAL NOT NULL CHECK (traction BETWEEN 0 AND 100),
        braking REAL NOT NULL CHECK (braking BETWEEN 0 AND 100),
        tyre_management REAL NOT NULL CHECK (tyre_management BETWEEN 0 AND 100),
        engine_reliability REAL NOT NULL CHECK (engine_reliability BETWEEN 0 AND 100),
        gearbox_reliability REAL NOT NULL CHECK (gearbox_reliability BETWEEN 0 AND 100),
        brake_reliability REAL NOT NULL CHECK (brake_reliability BETWEEN 0 AND 100),
        suspension_reliability REAL NOT NULL CHECK (suspension_reliability BETWEEN 0 AND 100),
        electronics_reliability REAL NOT NULL CHECK (electronics_reliability BETWEEN 0 AND 100),
        development_points INTEGER NOT NULL DEFAULT 0 CHECK (development_points >= 0),
        regulation_cycle_id TEXT,
        UNIQUE (team_id, season)
      );

      CREATE TABLE circuits (
        circuit_id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL,
        circuit_type TEXT NOT NULL,
        length REAL NOT NULL CHECK (length > 0),
        corners INTEGER NOT NULL CHECK (corners > 0),
        low_speed_corners INTEGER NOT NULL DEFAULT 0 CHECK (low_speed_corners >= 0),
        medium_speed_corners INTEGER NOT NULL DEFAULT 0 CHECK (medium_speed_corners >= 0),
        high_speed_corners INTEGER NOT NULL DEFAULT 0 CHECK (high_speed_corners >= 0),
        chicanes INTEGER NOT NULL DEFAULT 0 CHECK (chicanes >= 0),
        hairpins INTEGER NOT NULL DEFAULT 0 CHECK (hairpins >= 0),
        elevation_change REAL NOT NULL DEFAULT 0,
        track_width REAL NOT NULL CHECK (track_width > 0),
        longest_straight REAL NOT NULL CHECK (longest_straight > 0),
        average_speed REAL NOT NULL CHECK (average_speed > 0),
        drs_zones INTEGER NOT NULL DEFAULT 0 CHECK (drs_zones >= 0),
        heavy_braking_zones INTEGER NOT NULL DEFAULT 0 CHECK (heavy_braking_zones >= 0),
        grip REAL NOT NULL CHECK (grip BETWEEN 0 AND 100),
        abrasion REAL NOT NULL CHECK (abrasion BETWEEN 0 AND 100),
        tyre_stress REAL NOT NULL CHECK (tyre_stress BETWEEN 0 AND 100),
        overtaking_difficulty INTEGER NOT NULL CHECK (overtaking_difficulty BETWEEN 1 AND 10),
        pit_lane_length REAL NOT NULL CHECK (pit_lane_length >= 0),
        pit_entry_difficulty INTEGER NOT NULL CHECK (pit_entry_difficulty BETWEEN 1 AND 10),
        pit_exit_difficulty INTEGER NOT NULL CHECK (pit_exit_difficulty BETWEEN 1 AND 10),
        safety_car_probability REAL NOT NULL CHECK (safety_car_probability BETWEEN 0 AND 1),
        weather_profile TEXT NOT NULL,
        rain_probability REAL NOT NULL CHECK (rain_probability BETWEEN 0 AND 1),
        weight_engine REAL NOT NULL CHECK (weight_engine BETWEEN 0 AND 1),
        weight_aero REAL NOT NULL CHECK (weight_aero BETWEEN 0 AND 1),
        weight_high_speed REAL NOT NULL CHECK (weight_high_speed BETWEEN 0 AND 1),
        weight_medium_speed REAL NOT NULL CHECK (weight_medium_speed BETWEEN 0 AND 1),
        weight_low_speed REAL NOT NULL CHECK (weight_low_speed BETWEEN 0 AND 1),
        weight_grip REAL NOT NULL CHECK (weight_grip BETWEEN 0 AND 1),
        weight_traction REAL NOT NULL CHECK (weight_traction BETWEEN 0 AND 1),
        weight_braking REAL NOT NULL CHECK (weight_braking BETWEEN 0 AND 1),
        CHECK (
          weight_engine + weight_aero + weight_high_speed + weight_medium_speed +
          weight_low_speed + weight_grip + weight_traction + weight_braking
          BETWEEN 0.999 AND 1.001
        )
      );

      CREATE TABLE races (
        race_id TEXT PRIMARY KEY,
        division_id TEXT NOT NULL REFERENCES divisions(division_id),
        season INTEGER NOT NULL CHECK (season >= 1),
        round INTEGER NOT NULL CHECK (round >= 1),
        circuit_id TEXT NOT NULL REFERENCES circuits(circuit_id),
        laps INTEGER NOT NULL CHECK (laps >= 8),
        weather TEXT NOT NULL,
        track_condition TEXT NOT NULL CHECK (track_condition IN ('dry', 'damp', 'wet', 'heavy-wet')),
        has_sprint INTEGER NOT NULL DEFAULT 0 CHECK (has_sprint IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('scheduled', 'running', 'completed', 'cancelled')),
        UNIQUE (division_id, season, round)
      );

      CREATE TABLE race_results (
        race_id TEXT NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
        session_type TEXT NOT NULL CHECK (session_type IN ('race', 'sprint')),
        driver_id TEXT NOT NULL REFERENCES drivers(driver_id),
        team_id TEXT NOT NULL REFERENCES teams(team_id),
        grid_position INTEGER CHECK (grid_position IS NULL OR grid_position > 0),
        finish_position INTEGER CHECK (finish_position IS NULL OR finish_position > 0),
        laps_completed INTEGER NOT NULL DEFAULT 0 CHECK (laps_completed >= 0),
        fastest_lap INTEGER NOT NULL DEFAULT 0 CHECK (fastest_lap IN (0, 1)),
        pit_stops INTEGER NOT NULL DEFAULT 0 CHECK (pit_stops >= 0),
        tyre_strategy TEXT,
        points REAL NOT NULL DEFAULT 0 CHECK (points >= 0),
        dnf INTEGER NOT NULL DEFAULT 0 CHECK (dnf IN (0, 1)),
        dnf_reason TEXT,
        race_time REAL CHECK (race_time IS NULL OR race_time >= 0),
        PRIMARY KEY (race_id, session_type, driver_id)
      );

      CREATE TABLE finances (
        transaction_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season >= 1),
        race INTEGER CHECK (race IS NULL OR race >= 1),
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        amount INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE standings (
        standing_id TEXT PRIMARY KEY,
        season INTEGER NOT NULL CHECK (season >= 1),
        division_id TEXT NOT NULL REFERENCES divisions(division_id),
        driver_id TEXT REFERENCES drivers(driver_id),
        team_id TEXT REFERENCES teams(team_id),
        points REAL NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
        podiums INTEGER NOT NULL DEFAULT 0 CHECK (podiums >= 0),
        poles INTEGER NOT NULL DEFAULT 0 CHECK (poles >= 0),
        fastest_laps INTEGER NOT NULL DEFAULT 0 CHECK (fastest_laps >= 0),
        dnfs INTEGER NOT NULL DEFAULT 0 CHECK (dnfs >= 0),
        CHECK ((driver_id IS NOT NULL) OR (team_id IS NOT NULL))
      );

      CREATE INDEX idx_teams_career_division ON teams(career_id, division_id, is_active);
      CREATE INDEX idx_drivers_career_age ON drivers(career_id, age, is_retired);
      CREATE INDEX idx_contracts_team_season ON driver_contracts(team_id, start_season, end_season);
      CREATE INDEX idx_races_division_season ON races(division_id, season, round);
      CREATE INDEX idx_results_driver ON race_results(driver_id, race_id);
      CREATE INDEX idx_finances_team_season ON finances(team_id, season);
      CREATE INDEX idx_standings_division_season ON standings(division_id, season, points DESC);
    `,
  },
  {
    version: 2,
    description: "preserve source circuit standard laps and estimated lap time",
    sql: `
      ALTER TABLE circuits ADD COLUMN standard_laps INTEGER NOT NULL DEFAULT 0 CHECK (standard_laps >= 0);
      ALTER TABLE circuits ADD COLUMN estimated_lap_seconds REAL NOT NULL DEFAULT 0 CHECK (estimated_lap_seconds >= 0);
    `,
  },
  {
    version: 3,
    description: "store immutable source team pool with original strength classes and character",
    sql: `
      CREATE TABLE IF NOT EXISTS team_pool (
        pool_team_id TEXT PRIMARY KEY,
        tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 6),
        name TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL,
        strength_class TEXT NOT NULL CHECK (strength_class IN ('Kuat', 'Menengah', 'Lemah')),
        finance_grade TEXT NOT NULL CHECK (finance_grade IN ('A', 'B', 'C', 'D')),
        performance_grade TEXT NOT NULL CHECK (performance_grade IN ('A', 'B', 'C', 'D')),
        personality TEXT NOT NULL CHECK (personality IN ('Championship', 'Aggressive', 'Conservative', 'Driver Development')),
        character TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_team_pool_tier_strength ON team_pool(tier, strength_class);
    `,
  },
  {
    version: 4,
    description: "store culture-aware name ingredients and blocked real-driver names",
    sql: `
      CREATE TABLE IF NOT EXISTS name_culture_pool (
        culture_id TEXT NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'surname')),
        name TEXT NOT NULL,
        PRIMARY KEY (culture_id, gender, name)
      );
      CREATE TABLE IF NOT EXISTS nationality_name_cultures (
        country_code TEXT PRIMARY KEY,
        country_name TEXT NOT NULL,
        global_weight INTEGER NOT NULL CHECK (global_weight >= 0),
        culture_weights_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocked_names (
        normalized_full_name TEXT PRIMARY KEY,
        display_name TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_name_pool_lookup ON name_culture_pool(culture_id, gender);
    `,
  },
  {
    version: 5,
    description: "store manager, staff, sponsor, and board-objective career state",
    sql: `
      CREATE TABLE career_managers (
        manager_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT REFERENCES teams(team_id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        nationality TEXT NOT NULL,
        name_culture TEXT NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
        age INTEGER NOT NULL CHECK (age BETWEEN 18 AND 81),
        reputation INTEGER NOT NULL DEFAULT 0 CHECK (reputation BETWEEN 0 AND 9999),
        is_player INTEGER NOT NULL DEFAULT 0 CHECK (is_player IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('active', 'free_agent', 'retired')),
        UNIQUE (career_id, name)
      );

      CREATE TABLE staff (
        staff_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT REFERENCES teams(team_id) ON DELETE SET NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        nationality TEXT NOT NULL,
        name_culture TEXT NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
        age INTEGER NOT NULL CHECK (age BETWEEN 28 AND 81),
        skill REAL NOT NULL CHECK (skill BETWEEN 0 AND 100),
        specialization TEXT NOT NULL,
        region_assigned TEXT,
        reputation INTEGER NOT NULL DEFAULT 0 CHECK (reputation BETWEEN 0 AND 9999),
        salary INTEGER NOT NULL DEFAULT 0 CHECK (salary >= 0),
        potential REAL NOT NULL CHECK (potential BETWEEN 0 AND 100),
        contract_end INTEGER,
        is_free_agent INTEGER NOT NULL DEFAULT 1 CHECK (is_free_agent IN (0, 1)),
        UNIQUE (career_id, name)
      );
      CREATE INDEX idx_staff_career_role ON staff(career_id, role, is_free_agent);

      CREATE TABLE sponsor_pool (
        sponsor_id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
        origin TEXT NOT NULL CHECK (origin IN ('Global', 'Indonesia')),
        base_value INTEGER NOT NULL CHECK (base_value > 0),
        duration_seasons INTEGER NOT NULL CHECK (duration_seasons BETWEEN 1 AND 5),
        focus TEXT NOT NULL CHECK (focus IN ('Poin', 'Podium', 'Menang', 'Finish', 'Popularitas')),
        min_team_reputation INTEGER NOT NULL CHECK (min_team_reputation BETWEEN 0 AND 9999)
      );

      CREATE TABLE team_sponsors (
        team_sponsor_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        sponsor_id TEXT NOT NULL REFERENCES sponsor_pool(sponsor_id),
        start_season INTEGER NOT NULL CHECK (start_season >= 1),
        end_season INTEGER NOT NULL CHECK (end_season >= start_season),
        contract_value INTEGER NOT NULL CHECK (contract_value > 0),
        focus TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        UNIQUE (team_id, sponsor_id, start_season)
      );

      CREATE TABLE sponsor_offers (
        offer_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        sponsor_id TEXT NOT NULL REFERENCES sponsor_pool(sponsor_id),
        contract_value INTEGER NOT NULL CHECK (contract_value > 0),
        duration_seasons INTEGER NOT NULL CHECK (duration_seasons BETWEEN 1 AND 5),
        focus TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('offered', 'accepted', 'declined', 'expired')),
        created_season INTEGER NOT NULL CHECK (created_season >= 1),
        UNIQUE (career_id, team_id, sponsor_id)
      );
      CREATE INDEX idx_sponsor_offers_team_status ON sponsor_offers(team_id, status);

      CREATE TABLE board_objectives (
        objective_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season >= 1),
        objective_type TEXT NOT NULL CHECK (objective_type IN ('standings', 'financial', 'unlock_division')),
        target_value REAL NOT NULL,
        result TEXT,
        manager_fired INTEGER NOT NULL DEFAULT 0 CHECK (manager_fired IN (0, 1)),
        UNIQUE (team_id, season, objective_type)
      );
    `,
  },
  {
    version: 6,
    description: "record idempotent season financial settlements",
    sql: `
      CREATE TABLE season_settlements (
        settlement_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        division_id TEXT NOT NULL REFERENCES divisions(division_id),
        season INTEGER NOT NULL CHECK (season >= 1),
        prize_money INTEGER NOT NULL DEFAULT 0,
        commercial_revenue INTEGER NOT NULL DEFAULT 0,
        sponsor_revenue INTEGER NOT NULL DEFAULT 0,
        interest_cost INTEGER NOT NULL DEFAULT 0,
        facility_maintenance INTEGER NOT NULL DEFAULT 0,
        net_amount INTEGER NOT NULL,
        closing_cash INTEGER NOT NULL,
        settlement_json TEXT NOT NULL,
        settled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (career_id, season, team_id)
      );
      CREATE INDEX idx_season_settlements_career ON season_settlements(career_id, season);
    `,
  },
  {
    version: 7,
    description: "persist active development projects and completed development history",
    sql: `
      CREATE TABLE development_projects (
        project_instance_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        car_id TEXT NOT NULL REFERENCES cars(car_id) ON DELETE CASCADE,
        project_catalog_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('aero', 'engine', 'chassis', 'reliability')),
        size TEXT NOT NULL CHECK (size IN ('minor', 'standard', 'major')),
        cost INTEGER NOT NULL CHECK (cost >= 0),
        progress_races REAL NOT NULL DEFAULT 0 CHECK (progress_races >= 0),
        duration_races REAL NOT NULL CHECK (duration_races > 0),
        start_season INTEGER NOT NULL CHECK (start_season >= 1),
        start_round INTEGER NOT NULL CHECK (start_round >= 1),
        world_seed TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
        result_json TEXT,
        completed_season INTEGER,
        completed_round INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_development_projects_active ON development_projects(career_id, team_id, status);
      CREATE TABLE development_history (
        history_id TEXT PRIMARY KEY,
        project_instance_id TEXT NOT NULL REFERENCES development_projects(project_instance_id) ON DELETE CASCADE,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season >= 1),
        round INTEGER NOT NULL CHECK (round >= 1),
        project_catalog_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        size TEXT NOT NULL CHECK (size IN ('minor', 'standard', 'major')),
        status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled', 'failed')),
        success INTEGER CHECK (success IS NULL OR success IN (0, 1)),
        reason TEXT,
        cost INTEGER NOT NULL CHECK (cost >= 0),
        refund INTEGER NOT NULL DEFAULT 0 CHECK (refund >= 0),
        result_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_development_history_team ON development_history(career_id, team_id, season, round);
    `,
  },
  {
    version: 8,
    description: "persist driver negotiation cooldowns after rejected offers",
    sql: `
      CREATE TABLE driver_negotiation_cooldowns (
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        driver_id TEXT NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        last_score REAL NOT NULL,
        until_season INTEGER NOT NULL CHECK (until_season >= 1),
        until_race INTEGER NOT NULL CHECK (until_race >= 1),
        rejection_reason TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (career_id, driver_id, team_id)
      );
      CREATE INDEX idx_driver_negotiation_cooldown ON driver_negotiation_cooldowns(career_id, team_id, until_season, until_race);
    `,
  },
  {
    version: 9,
    description: "persist manager board confidence and consecutive primary objective misses",
    sql: `
      ALTER TABLE career_managers ADD COLUMN confidence INTEGER NOT NULL DEFAULT 60 CHECK (confidence BETWEEN 0 AND 100);
      ALTER TABLE career_managers ADD COLUMN consecutive_primary_misses INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_primary_misses >= 0);
    `,
  },
  {
    version: 10,
    description: "persist team division movement history and severe financial distress",
    sql: `
      ALTER TABLE teams ADD COLUMN severe_distress_seasons INTEGER NOT NULL DEFAULT 0 CHECK (severe_distress_seasons >= 0);
      CREATE TABLE team_division_history (
        history_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season >= 1),
        from_tier INTEGER NOT NULL CHECK (from_tier BETWEEN 1 AND 6),
        to_tier INTEGER CHECK (to_tier IS NULL OR to_tier BETWEEN 1 AND 6),
        reason TEXT NOT NULL CHECK (reason IN ('financial_relegation', 'financial_promotion', 'bankruptcy', 'new_entrant', 'player_move')),
        affordability REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_team_division_history_career ON team_division_history(career_id, season, team_id);
    `,
  },
  {
    version: 11,
    description: "track idempotent world season transition steps",
    sql: `
      CREATE TABLE world_transition_steps (
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season >= 1),
        step TEXT NOT NULL,
        result_json TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (career_id, season, step)
      );
      CREATE INDEX idx_world_transition_steps_season ON world_transition_steps(career_id, season, completed_at);
    `,
  },
  {
    version: 12,
    description: "persist expected board rank and manager job offers",
    sql: `
      ALTER TABLE board_objectives ADD COLUMN expected_rank INTEGER NOT NULL DEFAULT 6 CHECK (expected_rank BETWEEN 1 AND 12);
      CREATE TABLE manager_job_offers (
        offer_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        manager_id TEXT NOT NULL REFERENCES career_managers(manager_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        offered_season INTEGER NOT NULL CHECK (offered_season >= 1),
        reason TEXT NOT NULL CHECK (reason IN ('dismissal', 'reputation')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (manager_id, team_id, offered_season)
      );
      CREATE INDEX idx_manager_job_offers_pending ON manager_job_offers(career_id, manager_id, status, offered_season);
    `,
  },
  {
    version: 13,
    description: "record idempotent mid-season board objective warnings",
    sql: `
      CREATE TABLE board_objective_warnings (
        warning_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season >= 1),
        checkpoint_percent INTEGER NOT NULL CHECK (checkpoint_percent IN (50, 80)),
        completed_rounds INTEGER NOT NULL CHECK (completed_rounds >= 1),
        total_rounds INTEGER NOT NULL CHECK (total_rounds >= completed_rounds),
        target_rank INTEGER NOT NULL CHECK (target_rank BETWEEN 1 AND 12),
        forecast_rank INTEGER NOT NULL CHECK (forecast_rank BETWEEN 1 AND 12),
        at_risk INTEGER NOT NULL CHECK (at_risk IN (0, 1)),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (career_id, team_id, season, checkpoint_percent)
      );
      CREATE INDEX idx_board_warnings_dashboard
        ON board_objective_warnings(career_id, team_id, season, at_risk);
    `,
  },
  {
    version: 14,
    description: "persist player division unlock and promotion choices",
    sql: `
      CREATE TABLE division_promotion_offers (
        offer_id TEXT PRIMARY KEY,
        career_id TEXT NOT NULL REFERENCES career(career_id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season >= 1),
        current_tier INTEGER NOT NULL CHECK (current_tier BETWEEN 2 AND 6),
        target_tier INTEGER NOT NULL CHECK (target_tier = current_tier - 1),
        unlock_awarded INTEGER NOT NULL DEFAULT 0 CHECK (unlock_awarded IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'promoted', 'stayed')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        UNIQUE (career_id, team_id, season)
      );
      CREATE INDEX idx_division_promotion_pending
        ON division_promotion_offers(career_id, team_id, status, season);
    `,
  },
];

export async function runMigrations(database: IDatabase): Promise<void> {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const rows = await database.query("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations;");
  const currentVersion = Number(rows[0]?.version ?? 0);
  const pending = [...DATABASE_MIGRATIONS].sort((left, right) => left.version - right.version)
    .filter((migration) => migration.version > currentVersion);

  for (const migration of pending) {
    await database.transaction(async () => {
      await database.execute(migration.sql);
      await database.run(
        "INSERT INTO schema_migrations (version, description) VALUES (?, ?);",
        [migration.version, migration.description],
      );
    });
  }
}
