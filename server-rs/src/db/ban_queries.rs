use super::models::*;
use rusqlite::{params, Connection, OptionalExtension};

// ── Ban queries ─────────────────────────────────────────────────────────────

pub fn create_ban(conn: &Connection, ban: &Ban) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO bans (team_id, user_id, banned_by, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![ban.team_id, ban.user_id, ban.banned_by, ban.reason, ban.created_at],
    )?;
    Ok(())
}

pub fn delete_ban(
    conn: &Connection,
    team_id: &str,
    user_id: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM bans WHERE team_id = ?1 AND user_id = ?2",
        params![team_id, user_id],
    )?;
    Ok(())
}

pub fn get_ban(
    conn: &Connection,
    team_id: &str,
    user_id: &str,
) -> Result<Option<Ban>, rusqlite::Error> {
    conn.query_row(
        "SELECT team_id, user_id, banned_by, reason, created_at FROM bans WHERE team_id = ?1 AND user_id = ?2",
        params![team_id, user_id],
        |row| {
            Ok(Ban {
                team_id: row.get(0)?,
                user_id: row.get(1)?,
                banned_by: row.get(2)?,
                reason: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                created_at: row.get(4)?,
            })
        },
    )
    .optional()
}

#[allow(dead_code)]
pub fn get_banned_users(
    conn: &Connection,
    team_id: &str,
) -> Result<Vec<Ban>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT team_id, user_id, banned_by, reason, created_at FROM bans WHERE team_id = ?1",
    )?;
    let rows = stmt.query_map([team_id], |row| {
        Ok(Ban {
            team_id: row.get(0)?,
            user_id: row.get(1)?,
            banned_by: row.get(2)?,
            reason: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            created_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::*;

    // ── Ban tests ───────────────────────────────────────────────────────

    #[test]
    fn test_create_ban_and_fetch() {
        let db = test_db();
        let owner = make_user("u1", "owner", &[1u8; 32]);
        let target = make_user("u2", "target", &[2u8; 32]);
        db.with_conn(|c| crate::db::create_user(c, &owner)).unwrap();
        db.with_conn(|c| crate::db::create_user(c, &target)).unwrap();
        let team = make_team("t1", "Team", "u1");
        db.with_conn(|c| crate::db::create_team(c, &team)).unwrap();

        let ban = Ban {
            team_id: "t1".into(), user_id: "u2".into(), banned_by: "u1".into(),
            reason: "spamming".into(), created_at: crate::db::now_str(),
        };
        db.with_conn(|c| create_ban(c, &ban)).unwrap();

        let fetched = db.with_conn(|c| get_ban(c, "t1", "u2")).unwrap().unwrap();
        assert_eq!(fetched.reason, "spamming");
        assert_eq!(fetched.banned_by, "u1");
    }

    #[test]
    fn test_delete_ban() {
        let db = test_db();
        let owner = make_user("u1", "owner", &[1u8; 32]);
        let target = make_user("u2", "target", &[2u8; 32]);
        db.with_conn(|c| crate::db::create_user(c, &owner)).unwrap();
        db.with_conn(|c| crate::db::create_user(c, &target)).unwrap();
        let team = make_team("t1", "Team", "u1");
        db.with_conn(|c| crate::db::create_team(c, &team)).unwrap();

        let ban = Ban {
            team_id: "t1".into(), user_id: "u2".into(), banned_by: "u1".into(),
            reason: "".into(), created_at: crate::db::now_str(),
        };
        db.with_conn(|c| create_ban(c, &ban)).unwrap();
        db.with_conn(|c| delete_ban(c, "t1", "u2")).unwrap();

        let result = db.with_conn(|c| get_ban(c, "t1", "u2")).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_get_banned_users() {
        let db = test_db();
        let owner = make_user("u1", "owner", &[1u8; 32]);
        let u2 = make_user("u2", "user2", &[2u8; 32]);
        let u3 = make_user("u3", "user3", &[3u8; 32]);
        db.with_conn(|c| crate::db::create_user(c, &owner)).unwrap();
        db.with_conn(|c| crate::db::create_user(c, &u2)).unwrap();
        db.with_conn(|c| crate::db::create_user(c, &u3)).unwrap();
        let team = make_team("t1", "Team", "u1");
        db.with_conn(|c| crate::db::create_team(c, &team)).unwrap();

        let now = crate::db::now_str();
        for uid in &["u2", "u3"] {
            let ban = Ban {
                team_id: "t1".into(), user_id: uid.to_string(), banned_by: "u1".into(),
                reason: "".into(), created_at: now.clone(),
            };
            db.with_conn(|c| create_ban(c, &ban)).unwrap();
        }

        let bans = db.with_conn(|c| get_banned_users(c, "t1")).unwrap();
        assert_eq!(bans.len(), 2);
    }
}
