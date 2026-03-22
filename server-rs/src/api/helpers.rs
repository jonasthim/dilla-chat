use serde_json::Value;

use axum::Json;

use crate::db;
use crate::error::AppError;

/// Verify that a user is a member of the given team, returning `Err` if not.
pub fn require_team_member(
    conn: &rusqlite::Connection,
    user_id: &str,
    team_id: &str,
) -> Result<(), rusqlite::Error> {
    if db::get_member_by_user_and_team(conn, user_id, team_id)?.is_none() {
        return Err(rusqlite::Error::InvalidParameterName(
            "not a member of this team".into(),
        ));
    }
    Ok(())
}

/// Check that a user has a specific permission in a team, returning `Err` if not.
pub fn require_permission(
    conn: &rusqlite::Connection,
    user_id: &str,
    team_id: &str,
    permission: i64,
) -> Result<(), rusqlite::Error> {
    if !db::user_has_permission(conn, user_id, team_id, permission)? {
        return Err(rusqlite::Error::InvalidParameterName(
            "insufficient permissions".into(),
        ));
    }
    Ok(())
}

/// Run a blocking database closure on `spawn_blocking` and flatten the join error.
pub async fn spawn_db<F, T>(db: db::Database, f: F) -> Result<T, AppError>
where
    F: FnOnce(&rusqlite::Connection) -> Result<T, rusqlite::Error> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || db.with_conn(f))
        .await
        .map_err(|e| AppError::Internal(format!("task join: {}", e)))?
        .map_err(map_db_error)
}

/// Map a rusqlite error to the appropriate AppError variant.
///
/// - `InvalidParameterName` -> `Forbidden`
/// - `QueryReturnedNoRows` -> `NotFound` with a generic message
/// - everything else -> `Internal`
pub fn map_db_error(e: rusqlite::Error) -> AppError {
    match e {
        rusqlite::Error::InvalidParameterName(msg) => AppError::Forbidden(msg),
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("not found".into()),
        other => AppError::Internal(format!("db: {}", other)),
    }
}

/// Convenience: wrap a serializable value in `Json<Value>`.
pub fn json_ok<T: serde::Serialize>(val: T) -> Result<Json<Value>, AppError> {
    Ok(Json(serde_json::json!(val)))
}

/// Convenience: return `{ "ok": true }` as JSON.
pub fn json_ok_true() -> Result<Json<Value>, AppError> {
    Ok(Json(serde_json::json!({ "ok": true })))
}
