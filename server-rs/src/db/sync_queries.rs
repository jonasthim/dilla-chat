use super::models::*;
use rusqlite::{params, Connection};

// ── Federation sync update queries ──────────────────────────────────────────

pub fn update_channel_from_sync(conn: &Connection, ch: &Channel) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE channels SET name = ?1, topic = ?2, category = ?3, position = ?4, updated_at = ?5 WHERE id = ?6",
        params![ch.name, ch.topic, ch.category, ch.position, ch.updated_at, ch.id],
    )?;
    Ok(())
}

pub fn update_role_from_sync(conn: &Connection, role: &Role) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE roles SET name = ?1, color = ?2, position = ?3, permissions = ?4, updated_at = ?5 WHERE id = ?6",
        params![role.name, role.color, role.position, role.permissions, role.updated_at, role.id],
    )?;
    Ok(())
}

pub fn update_member_from_sync(conn: &Connection, member: &Member) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE members SET nickname = ?1, updated_at = ?2 WHERE id = ?3",
        params![member.nickname, member.updated_at, member.id],
    )?;
    Ok(())
}

pub fn update_message_from_sync(conn: &Connection, msg: &Message) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE messages SET content = ?1, edited_at = ?2, deleted = ?3 WHERE id = ?4",
        params![msg.content, msg.edited_at, msg.deleted as i32, msg.id],
    )?;
    Ok(())
}
