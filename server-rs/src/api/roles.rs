use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::Value;

use crate::api::helpers::{json_ok, json_ok_true, require_permission, require_team_member, spawn_db};
use crate::api::AppState;
use crate::auth::UserId;
use crate::db;
use crate::error::AppError;

#[derive(Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub permissions: i64,
}

fn default_color() -> String {
    "#99AAB5".into()
}

#[derive(Deserialize)]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub color: Option<String>,
    pub permissions: Option<i64>,
    pub position: Option<i32>,
}

#[derive(Deserialize)]
pub struct ReorderRequest {
    pub role_ids: Vec<String>,
}

pub async fn list(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path(team_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let roles = spawn_db(state.db.clone(), move |conn| {
        require_team_member(conn, &user_id, &team_id)?;
        db::get_roles_by_team(conn, &team_id)
    })
    .await?;

    json_ok(roles)
}

pub async fn create(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path(team_id): Path<String>,
    Json(body): Json<CreateRoleRequest>,
) -> Result<Json<Value>, AppError> {
    if body.name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }

    let role = spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_MANAGE_ROLES)?;

        // Get current max position.
        let roles = db::get_roles_by_team(conn, &team_id)?;
        let max_pos = roles.iter().map(|r| r.position).max().unwrap_or(0);

        let role = db::Role {
            id: db::new_id(),
            team_id: team_id.clone(),
            name: body.name.clone(),
            color: body.color.clone(),
            position: max_pos + 1,
            permissions: body.permissions,
            is_default: false,
            created_at: db::now_str(),
            updated_at: String::new(),
        };
        db::create_role(conn, &role)?;
        Ok(role)
    })
    .await?;

    json_ok(role)
}

pub async fn update(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path((team_id, role_id)): Path<(String, String)>,
    Json(body): Json<UpdateRoleRequest>,
) -> Result<Json<Value>, AppError> {
    let role = spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_MANAGE_ROLES)?;

        let mut role = get_role_for_team(conn, &role_id, &team_id)?;
        apply_role_updates(&mut role, &body);
        db::update_role(conn, &role)?;
        Ok(role)
    })
    .await
    .map_err(|e| match e {
        AppError::NotFound(_) => AppError::NotFound("role not found".into()),
        other => other,
    })?;

    json_ok(role)
}

pub async fn delete_role(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path((team_id, role_id)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_MANAGE_ROLES)?;

        let role = db::get_role_by_id(conn, &role_id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;

        if role.team_id != team_id {
            return Err(rusqlite::Error::InvalidParameterName(
                "role does not belong to this team".into(),
            ));
        }

        if role.is_default {
            return Err(rusqlite::Error::InvalidParameterName(
                "cannot delete the default role".into(),
            ));
        }

        db::delete_role(conn, &role_id)?;
        Ok(())
    })
    .await
    .map_err(|e| match e {
        AppError::NotFound(_) => AppError::NotFound("role not found".into()),
        other => other,
    })?;

    json_ok_true()
}

pub async fn reorder(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path(team_id): Path<String>,
    Json(body): Json<ReorderRequest>,
) -> Result<Json<Value>, AppError> {
    if body.role_ids.is_empty() {
        return Err(AppError::BadRequest("role_ids is required".into()));
    }

    let roles = spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_MANAGE_ROLES)?;

        for (i, role_id) in body.role_ids.iter().enumerate() {
            if let Some(mut role) = db::get_role_by_id(conn, role_id)? {
                if role.team_id == team_id {
                    role.position = i as i32;
                    db::update_role(conn, &role)?;
                }
            }
        }

        db::get_roles_by_team(conn, &team_id)
    })
    .await?;

    json_ok(roles)
}

/// Fetch a role by ID and verify it belongs to the given team.
fn get_role_for_team(
    conn: &rusqlite::Connection,
    role_id: &str,
    team_id: &str,
) -> Result<db::Role, rusqlite::Error> {
    let role = db::get_role_by_id(conn, role_id)?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)?;

    if role.team_id != team_id {
        return Err(rusqlite::Error::InvalidParameterName(
            "role does not belong to this team".into(),
        ));
    }
    Ok(role)
}

/// Apply optional update fields to a role.
fn apply_role_updates(role: &mut db::Role, body: &UpdateRoleRequest) {
    if let Some(ref name) = body.name {
        role.name = name.clone();
    }
    if let Some(ref color) = body.color {
        role.color = color.clone();
    }
    if let Some(perms) = body.permissions {
        role.permissions = perms;
    }
    if let Some(pos) = body.position {
        role.position = pos;
    }
}
